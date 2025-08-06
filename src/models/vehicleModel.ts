import { Document, Schema, model, Types } from "mongoose";

export interface IVehicle extends Document {
  vehicleNumber: string;
  vehicleType: string;
  make: string;
  vechicleModel: string;
  year: number;
  color: string;
  registrationDate: Date;
  insuranceExpiry: Date;
  lastServiceDate: Date;
  currentMileage: number;
  status: "active" | "inactive" | "maintenance";
  attachments: Types.DocumentArray<IAttachment>;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface IAttachment extends Document {
  fileName: string;
  fileType: string;
  filePath: string;
}

const attachmentSchema = new Schema<IAttachment>({
  fileName: { type: String, required: true },
  fileType: { type: String, required: true },
  filePath: { type: String, required: true },
});

const vehicleSchema = new Schema<IVehicle>(
  {
    vehicleNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      uppercase: true,
    },
    vehicleType: {
      type: String,
      required: true,
      enum: ["car", "truck", "van", "pickup", "motorcycle", "other"],
    },
    make: { type: String, required: true, trim: true },
    vechicleModel: { type: String, required: true, trim: true },
    year: {
      type: Number,
      required: true,
      min: 1900,
      max: new Date().getFullYear() + 1,
    },
    color: { type: String, trim: true },
    registrationDate: { type: Date, required: true },
    insuranceExpiry: { type: Date, required: true },
    lastServiceDate: { type: Date },
    currentMileage: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["active", "inactive", "maintenance"],
      default: "active",
    },
    attachments: [attachmentSchema],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
vehicleSchema.index({ vehicleNumber: 1 });
vehicleSchema.index({ vehicleType: 1 });
vehicleSchema.index({ status: 1 });
vehicleSchema.index({ make: 1 });
vehicleSchema.index({ model: 1 });

export const Vehicle = model<IVehicle>("Vehicle", vehicleSchema);
