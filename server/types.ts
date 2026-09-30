import type { QueryResultRow } from 'pg';

export interface MeetingInput {
  meeting_date?: string;
  days?: string;
  time?: string;
  building?: string;
  room?: string;
}

export interface CourseInput {
  registration_status?: string;
  crn: string;
  course_code?: string;
  section?: string;
  course_name?: string;
  credits?: number;
  type?: string;
  instructor?: string;
  also_register_in?: string;
  term?: string;
  year?: number;
  meeting_infos?: MeetingInput | MeetingInput[];
}

export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  connect?(): Promise<Queryable & { release(): void }>;
}
