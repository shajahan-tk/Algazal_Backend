import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Project } from '../models/projectModel'; // Adjust path if necessary

// Configure environment variables
dotenv.config({ path: path.join(__dirname, '../../.env') }); // Adjust path based on file location

/**
 * Migrates project data by moving the 'assignedDriver' field
 * into a new 'assigQnedDrivers' array and unsetting the old field.
 * This function is designed to be called from a script or an API endpoint.
 */
export const migrateProjectDrivers = async () => {
    // Check if already connected, if not, connect.
    // This makes the function runnable both from a standalone script and an API request.
    if (mongoose.connection.readyState !== 1) {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in environment variables');
        }
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');
    }

    try {
        console.log('Starting project driver migration...');

        // Find all projects that have assignedDriver set
        const projects = await Project.find({ assignedDriver: { $exists: true, $ne: null } }).lean();

        if (projects.length === 0) {
            console.log('No projects found with assignedDriver. Migration is already complete.');
            return 'No projects found requiring migration.';
        }

        console.log(`Found ${projects.length} projects with assignedDriver.`);

        let processedCount = 0;

        for (const p of projects) {
            const project: any = p;

            if (project.assignedDriver) {
                const driverId = project.assignedDriver;

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

        const message = `Migration completed. Processed ${processedCount} projects.`;
        console.log(message);
        return message;

    } catch (error) {
        console.error('Migration failed:', error);
        // Throw the error so it can be caught by the caller (e.g., asyncHandler)
        throw error;
    }
};

// This block allows the script to be run directly from the command line
// while also being importable as a function for the API route.
if (require.main === module) {
    migrateProjectDrivers()
        .then(() => {
            console.log('Script finished successfully.');
            process.exit(0);
        })
        .catch(err => {
            console.error('Script failed:', err);
            process.exit(1);
        });
}