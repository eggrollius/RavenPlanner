import { RavenApiClient } from './api_client.js';
import { coursePayload, type ScrapedCourse } from './parser.js';

export async function publishCourses(courses: ScrapedCourse[], api = new RavenApiClient(), log: (message: string) => void = console.log) {
  let successfulUpdates = 0;
  let successfulAdditions = 0;
  let failedOperations = 0;

  for (const course of courses) {
    if (course.course_name === undefined) throw new Error('Missing course_name');
    log(`Creating course: '${course.course_name}`);
    const payload = coursePayload(course);
    try {
      const response = await api.checkCourseExistsByCrn(payload.crn);
      if (!Object.hasOwn(response, 'exists')) throw new Error('Missing exists in course existence response');
      if (response.exists) {
        await api.updateCourseByCrn(payload.crn, payload);
        successfulUpdates += 1;
      } else {
        await api.addCourse(payload);
        successfulAdditions += 1;
      }
    } catch (error) {
      log(`An error occurred while processing course with CRN ${payload.crn}: ${error}`);
      failedOperations += 1;
    }
  }

  log(`Successfully updated ${successfulUpdates} courses.`);
  log(`Successfully added ${successfulAdditions} new courses.`);
  if (failedOperations > 0) log(`${failedOperations} operations failed.`);
  log('Done');
  return { successfulUpdates, successfulAdditions, failedOperations };
}
