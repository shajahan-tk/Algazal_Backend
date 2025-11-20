import mongoose, { Document, Schema } from "mongoose";

export interface ISettings extends Document {
    key: string;
    value: boolean;
    updatedAt: Date;
}

const settingsSchema = new Schema<ISettings>(
    {
        key: {
            type: String,
            required: true,
            unique: true,
        },
        value: {
            type: Boolean,
            required: true,
            default: true,
        },
    },
    {
        timestamps: true,
    }
);

export const Settings = mongoose.model<ISettings>("Settings", settingsSchema);