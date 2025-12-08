// src/models/kanbanTaskModel.ts
import { Document, Schema, model, Types } from "mongoose";

export interface IKanbanTask extends Document {
    title: string;
    description?: string;
    stage: 'todo' | 'in-progress' | 'review' | 'done';
    priority: 'low' | 'medium' | 'high' | 'urgent';
    assignedTo?: Types.ObjectId; // Only engineers
    createdBy: Types.ObjectId;
    dueDate?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

const kanbanTaskSchema = new Schema<IKanbanTask>(
    {
        title: {
            type: String,
            required: true,
            trim: true,
            maxlength: [100, "Task title cannot exceed 100 characters"],
        },
        description: {
            type: String,
            trim: true,
            maxlength: [500, "Description cannot exceed 500 characters"],
        },
        stage: {
            type: String,
            enum: ['todo', 'in-progress', 'review', 'done'],
            default: 'todo',
        },
        priority: {
            type: String,
            enum: ['low', 'medium', 'high', 'urgent'],
            default: 'medium',
        },
        assignedTo: {
            type: Schema.Types.ObjectId,
            ref: "User",
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        dueDate: {
            type: Date,
        },
    },
    { timestamps: true }
);

// Indexes for better query performance
kanbanTaskSchema.index({ stage: 1 });
kanbanTaskSchema.index({ priority: 1 });
kanbanTaskSchema.index({ createdBy: 1 });
kanbanTaskSchema.index({ assignedTo: 1 });
kanbanTaskSchema.index({ dueDate: 1 });

export const KanbanTask = model<IKanbanTask>("KanbanTask", kanbanTaskSchema);