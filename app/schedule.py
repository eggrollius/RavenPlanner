from typing import List, Dict
import datetime

class Class:
    def __init__(self, crn: int, start_date: datetime.date, time_schedule: Dict[str, List[datetime.time]]):
        """
        Initialize a Class object.

        :param crn: Unique course registration number.
        :param start_date: Start date of the class.
        :param time_schedule: A dictionary mapping days to a list of times when the class occurs on that day.
        """
        self.crn = crn
        self.start_date = start_date
        self.time_schedule = time_schedule

    def __repr__(self):
        return f"Class(crn={self.crn}, start_date={self.start_date}, time_schedule={self.time_schedule})"


class Package:
    def __init__(self, classes: List[Class]):
        """
        Initialize a Package object containing multiple classes.

        :param classes: A list of Class objects.
        """
        self.classes = classes
    def has_time_conflict(self, new_class: Class) -> bool:
        for existing_class in self.classes:
            for day, times in new_class.time_schedule.items():
                if day in existing_class.time_schedule:
                    existing_times = existing_class.time_schedule[day]
                    for new_time in times:
                        if new_time in existing_times:
                            return True
        return False

    def add_class(self, new_class: Class) -> bool:
        if not self.has_time_conflict(new_class):
            self.classes.append(new_class)
            return True
        return False

    def remove_class_by_crn(self, crn: int):
        """
        Remove a class from the package by its CRN.

        :param crn: The CRN of the class to be removed.
        """
        self.classes = [cls for cls in self.classes if cls.crn != crn]

    def __repr__(self):
        return f"Package(classes={self.classes})"

class Course:
    def __init__(self, packages):
        self.packages = packages

class Schedule:
    def __init__(self):
        self.packages = []
    def add_package(self, pacakge):

        self.packages.append()