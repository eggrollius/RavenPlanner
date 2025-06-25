from ortools.sat.python import cp_model
from datetime import datetime

def solve_schedule(required_crns, optional_crns, num_courses, preferences, top_k=1):
    from your_database_module import get_sections_by_crns  
    all_crns = required_crns + optional_crns
    section_data = get_sections_by_crns(all_crns)  # returns list of dicts

    model = cp_model.CpModel()
    crn_to_data = {sec["crn"]: sec for sec in section_data}
    crn_vars = {crn: model.NewBoolVar(crn) for crn in all_crns}

    # Required CRNs must be selected
    for crn in required_crns:
        model.Add(crn_vars[crn] == 1)

    # Total number of courses
    model.Add(sum(crn_vars[crn] for crn in all_crns) == num_courses)

    # Conflict detection
    def overlaps(s1, s2):
        if not set(s1["days"]).intersection(s2["days"]):
            return False
        fmt = "%H:%M"
        s1_start = datetime.strptime(s1["start"], fmt)
        s1_end = datetime.strptime(s1["end"], fmt)
        s2_start = datetime.strptime(s2["start"], fmt)
        s2_end = datetime.strptime(s2["end"], fmt)
        return not (s1_end <= s2_start or s2_end <= s1_start)

    for i in range(len(all_crns)):
        for j in range(i + 1, len(all_crns)):
            c1, c2 = all_crns[i], all_crns[j]
            if overlaps(crn_to_data[c1], crn_to_data[c2]):
                model.Add(crn_vars[c1] + crn_vars[c2] <= 1)

    # Preferences to minimize
    penalty_terms = []
    for crn in all_crns:
        sec = crn_to_data[crn]
        var = crn_vars[crn]

        if "avoid_times_before" in preferences:
            cutoff, weight = preferences["avoid_times_before"]
            if sec["start"] < cutoff:
                penalty_terms.append(weight * var)

        if "avoid_days" in preferences:
            days, weight = preferences["avoid_days"]
            if any(day in sec["days"] for day in days):
                penalty_terms.append(weight * var)

        if "avoid_professors" in preferences:
            profs, weight = preferences["avoid_professors"]
            if sec["prof"] in profs:
                penalty_terms.append(weight * var)

    model.Minimize(sum(penalty_terms))

    # Solver logic (top-k)
    solver = cp_model.CpSolver()
    results = []

    if top_k == 1:
        status = solver.Solve(model)
        if status in [cp_model.OPTIMAL, cp_model.FEASIBLE]:
            return [[crn for crn in all_crns if solver.Value(crn_vars[crn])]]
        return []

    else:
        class Collector(cp_model.CpSolverSolutionCallback):
            def __init__(self):
                super().__init__()
                self.found = 0

            def on_solution_callback(self):
                sol = [crn for crn in all_crns if self.Value(crn_vars[crn])]
                results.append(sol)
                self.found += 1
                if self.found >= top_k:
                    self.StopSearch()

        collector = Collector()
        solver.SearchForAllSolutions(model, collector)
        return results
