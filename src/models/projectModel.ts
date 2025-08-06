import { Document, Schema, model, Types, ObjectId } from "mongoose";
import { IClient } from "./clientModel";


export interface IProject extends Document {
  projectName: string;
  _id: ObjectId;
  projectDescription: string;
  client: Types.ObjectId | IClient;
  location: string;
  building: string;
  apartmentNumber: string;
  status:
    | "draft"
    | "estimation_prepared"
    | "quotation_sent"
    | "quotation_approved"
    | "quotation_rejected"
    | "lpo_received"
    | "team_assigned"
    | "work_started"
    | "in_progress"
    | "work_completed"
    | "quality_check"
    | "client_handover"
    | "final_invoice_sent"
    | "payment_received"
    | "on_hold"
    | "cancelled"
    | "project_closed";
  projectNumber: string;
  progress: number;
  createdBy: Types.ObjectId;
  updatedBy?: Types.ObjectId;
  assignedTo?: Types.ObjectId;
  assignedWorkers?: Types.ObjectId[];
  assignedDriver?: Types.ObjectId;
  // New fields for completion dates
  completionDate?: Date;
  handoverDate?: Date;
  acceptanceDate?: Date;

  //for some customers
  grnNumber?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const projectSchema = new Schema<IProject>(
  {
    projectName: {
      type: String,
      required: true,
      trim: true,
      maxlength: [100, "Project name cannot exceed 100 characters"],
    },
    projectDescription: {
      type: String,
      trim: true,
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    client: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required: true,
    },
    location: {
      type: String,
      required: true,
      trim: true,
    },
    building: {
      type: String,
      required: true,
      trim: true,
    },
    apartmentNumber: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "draft",
        "estimation_prepared",
        "quotation_sent",
        "quotation_approved",
        "quotation_rejected",
        "lpo_received",
        "team_assigned",
        "work_started",
        "in_progress",
        "work_completed",
        "quality_check",
        "client_handover",
        "final_invoice_sent",
        "payment_received",
        "on_hold",
        "cancelled",
        "project_closed",
      ],
      default: "draft",
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    // New date fields
    completionDate: { type: Date },
    handoverDate: { type: Date },
    acceptanceDate: { type: Date },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    projectNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    assignedWorkers: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    assignedDriver: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    grnNumber: {
      typw: String,
    },
  },
  { timestamps: true }
);

projectSchema.index({ projectName: 1 });
projectSchema.index({ client: 1 });
projectSchema.index({ status: 1 });
projectSchema.index({ progress: 1 });

export const Project = model<IProject>("Project", projectSchema);
