import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { Project } from '../models/projectModel'; // Adjust this path if your model is located elsewhere

// Configure environment variables from .env file
// This path assumes the script is in src/utils/ and .env is in the project root.
dotenv.config({ path: path.join(__dirname, '../../.env') });

/**
 * Migrates project data by moving the single 'assignedTo' field
 * into a new 'assignedEngineers' array and unsetting the old field.
 * This function is designed to be safe to run multiple times.
 */
export const migrateProjectEngineers = async () => {
    // Check if Mongoose is already connected. If not, connect.
    // This makes the function runnable both from a standalone script and an API request.
    if (mongoose.connection.readyState !== 1) {
        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI is not defined in environment variables. Please check your .env file.');
        }
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Successfully connected to MongoDB.');
    }

    try {
        console.log('Starting project engineer migration...');

        // Find all projects that have the 'assignedTo' field and its value is not null.
        const projectsToMigrate = await Project.find({ assignedTo: { $exists: true, $ne: null } }).lean();

        if (projectsToMigrate.length === 0) {
            console.log('No projects found with the "assignedTo" field. Migration is already complete or not needed.');
            return 'No projects found requiring migration.';
        }

        console.log(`Found ${projectsToMigrate.length} projects to migrate.`);

        let processedCount = 0;

        // Iterate over each project and perform the migration
        for (const project of projectsToMigrate) {
            // Type assertion to access the old field
            const projectWithOldField = project as any;

            if (projectWithOldField.assignedTo) {
                const engineerId = projectWithOldField.assignedTo;

                // Update the project document
                // 1. $addToSet: Adds the engineerId to the assignedEngineers array. It's idempotent, preventing duplicates.
                // 2. $unset: Removes the 'assignedTo' field from the document.
                await Project.updateOne(
                    { _id: project._id },
                    {
                        $addToSet: { assignedEngineers: engineerId },
                        $unset: { assignedTo: "" }
                    }
                );

                processedCount++;
                // Log progress every 10 projects to avoid flooding the console
                if (processedCount % 10 === 0) {
                    console.log(`Processed ${processedCount} projects...`);
                }
            }
        }

        const successMessage = `Migration completed successfully. Processed ${processedCount} projects.`;
        console.log(successMessage);
        return successMessage;

    } catch (error) {
        console.error('Migration failed:', error);
        // Re-throw the error so it can be caught by the caller (e.g., asyncHandler in an API route)
        throw error;
    }
};

// This block allows the script to be run directly from the command line
// while also being importable as a function for an API route.
if (require.main === module) {
    migrateProjectEngineers()
        .then(() => {
            console.log('Script finished successfully.');
            process.exit(0);
        })
        .catch(err => {
            console.error('Script failed with an error:', err);
            process.exit(1);
        });
}