import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { Project } from '../src/models/projectModel';

import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const migrateProjectDrivers = async () => {
    try {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in environment variables');
        }

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        console.log('Starting project driver migration...');

        // Find all projects that have assignedDriver set
        // We use 'any' to bypass strict type checking against the new model definition if it's already updated,
        // or the old one. We are accessing the raw document structure.
        const projects = await Project.find({ assignedDriver: { $exists: true, $ne: null } }).lean();

        console.log(`Found ${projects.length} projects with assignedDriver.`);

        let processedCount = 0;

        for (const p of projects) {
            const project: any = p;

            // If assignedDriver exists and assignedDrivers is empty or doesn't exist
            if (project.assignedDriver) {
                const driverId = project.assignedDriver;

                // Update the project:
                // 1. Add to assignedDrivers array
                // 2. Unset assignedDriver

                await Project.updateOne(
                    { _id: project._id },
                    {
                        $addToSet: { assignedDrivers: driverId },
                        $unset: { assignedDriver: "" }
                    }
                );

                processedCount++;
                if (processedCount % 10 === 0) {
                    console.log(`Processed ${processedCount} projects...`);
                }
            }
        }

        console.log(`Migration completed. Processed ${processedCount} projects.`);
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
};

migrateProjectDrivers();
