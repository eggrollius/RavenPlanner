export interface MeetingInfo { meeting_date: string; days: string; time: string; building: string; room: string }
export interface Course { id: number; registration_status: string; crn: string; course_code: string; section: string; course_name: string; credits: number; type: string; instructor: string; also_register_in: string; meeting_infos: MeetingInfo[] }
export interface CourseGroup { parent: Course; children: Course[] }
export interface SelectedCourse { code: string; sections: Record<string, CourseGroup>; disabled: Set<string> }
export interface ScheduleSection { parent: Course; child?: Course }
export interface Preferences { beforeEnabled: boolean; before: string; afterEnabled: boolean; after: string; prioritizeDaysOff: boolean }
