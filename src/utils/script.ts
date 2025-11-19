import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Attendance } from '../models/attendanceModel';

dotenv.config();

export const migrateAttendanceData = async () => {
    try {
        console.log('Starting migration...');

        // Aggregate records by user, date, and type
        const cursor = Attendance.aggregate([
            {
                $group: {
                    _id: { user: "$user", date: "$date", type: "$type" },
                    records: { $push: "$$ROOT" },
                    count: { $sum: 1 }
                }
            }
        ]).cursor();

        let processedCount = 0;

        for await (const group of cursor) {
            const { records } = group;

            // We process if there are multiple records OR if it's a single record that hasn't been migrated (no projects array)
            const needsMigration = records.length > 1 ||
                (records[0].type === 'project' && (!records[0].projects || records[0].projects.length === 0) && records[0].project);

            if (!needsMigration) continue;

            const projectsMap = new Map();
            let isPaidLeave = false;
            let present = false;
            let markedBy = records[0].markedBy;

            // Merge data from all records in the group
            for (const record of records) {
                if (record.isPaidLeave) isPaidLeave = true;
                if (record.present) present = true;
                if (record.markedBy) markedBy = record.markedBy;

                // Handle legacy 'project' field
                if (record.type === 'project' && record.project) {
                    const projectId = record.project.toString();
                    if (!projectsMap.has(projectId)) {
                        projectsMap.set(projectId, {
                            project: record.project,
                            workingHours: record.workingHours || 0,
                            markedBy: record.markedBy,
                            present: record.present !== false // Default to true if not explicitly false
                        });
                    }
                }

                // Handle existing 'projects' array (if partially migrated or mixed)
                if (record.projects && record.projects.length > 0) {
                    for (const p of record.projects) {
                        if (p.project) {
                            const pId = p.project.toString();
                            projectsMap.set(pId, {
                                project: p.project,
                                workingHours: p.workingHours,
                                markedBy: p.markedBy,
                                present: p.present
                            });
                        }
                    }
                }
            }

            const projects = Array.from(projectsMap.values());

            // Calculate totals
            let totalWorkingHours = 0;
            let totalOvertimeHours = 0;

            if (isPaidLeave) {
                totalWorkingHours = 0;
                totalOvertimeHours = 0;
                projects.forEach(p => {
                    p.workingHours = 0;
                    p.present = false;
                });
            } else {
                if (group._id.type === 'project') {
                    totalWorkingHours = projects.reduce((sum, p) => sum + (p.workingHours || 0), 0);
                } else {
                    // Normal attendance - sum up working hours from records
                    totalWorkingHours = records.reduce((sum: number, r: any) => sum + (r.workingHours || 0), 0);
                }

                // Calculate overtime (Daily > 10 hours)
                const basicHours = 10;
                if (totalWorkingHours > basicHours) {
                    totalOvertimeHours = totalWorkingHours - basicHours;
                }
            }

            // Round to 2 decimal places
            totalWorkingHours = Math.round(totalWorkingHours * 100) / 100;
            totalOvertimeHours = Math.round(totalOvertimeHours * 100) / 100;

            // Update primary record
            const primaryRecord = records[0];
            const updateData = {
                projects: projects,
                workingHours: totalWorkingHours,
                overtimeHours: totalOvertimeHours,
                present: present,
                isPaidLeave: isPaidLeave,
                markedBy: markedBy,
                project: projects.length > 0 ? projects[0].project : undefined // Sync legacy field
            };

            await Attendance.updateOne({ _id: primaryRecord._id }, { $set: updateData });

            // Delete other records
            const idsToDelete = records.slice(1).map((r: any) => r._id);
            if (idsToDelete.length > 0) {
                await Attendance.deleteMany({ _id: { $in: idsToDelete } });
            }

            processedCount++;
            if (processedCount % 100 === 0) {
                console.log(`Processed ${processedCount} groups...`);
            }
        }

        console.log(`Migration completed. Processed ${processedCount} groups.`);
    } catch (error) {
        console.error('Migration failed:', error);
        throw error;
    }
};

// If run directly
if (require.main === module) {
    if (!process.env.MONGODB_URI) {
        console.error('MONGODB_URI is not defined in environment variables');
        process.exit(1);
    }
    mongoose.connect(process.env.MONGODB_URI)
        .then(() => migrateAttendanceData())
        .then(() => {
            console.log('Done');
            process.exit(0);
        })
        .catch(err => {
            console.error(err);
            process.exit(1);
        });
}
