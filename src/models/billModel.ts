import { Document, Schema, model, Types } from "mongoose";

export interface IAttachment extends Document {
  fileName: string;
  fileType: string;
  filePath: string;
}

export type BillType =
  | "general"
  | "fuel"
  | "mess"
  | "vehicle"
  | "accommodation"
  | "commission";

export interface IBill extends Document {
  billType: BillType;
  billDate: Date;
  paymentMethod: string;
  amount: number;
  attachments: Types.DocumentArray<IAttachment>;
  createdBy: Types.ObjectId;

  // General Bill Fields
  category?: Types.ObjectId;
  shop?: Types.ObjectId;
  invoiceNo?: string;
  remarks?: string;

  // Fuel Bill Fields
  description?: string;
  vehicle?: Types.ObjectId;
  kilometer?: number;
  liter?: number;

  // Vehicle Bill Fields
  purpose?: string;
  vehicles?: Types.ObjectId[];

  // Accommodation Bill Fields
  roomNo?: string;
  note?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

const attachmentSchema = new Schema<IAttachment>({
  fileName: { type: String, required: true },
  fileType: { type: String, required: true },
  filePath: { type: String, required: true },
});

const billSchema = new Schema<IBill>(
  {
    billType: {
      type: String,
      required: true,
      enum: [
        "general",
        "fuel",
        "mess",
        "vehicle",
        "accommodation",
        "commission",
      ],
    },
    billDate: { type: Date, required: true },
    paymentMethod: { type: String, required: true },
    amount: { type: Number, required: true, min: 0 },
    attachments: [attachmentSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // General Bill Fields
    category: { type: Schema.Types.ObjectId, ref: "Category" },
    shop: { type: Schema.Types.ObjectId, ref: "Shop" },
    invoiceNo: { type: String, trim: true },
    remarks: { type: String, trim: true },

    // Fuel Bill Fields
    description: { type: String, trim: true },
    vehicle: { type: Schema.Types.ObjectId, ref: "Vehicle" },
    kilometer: { type: Number, min: 0 },
    liter: { type: Number, min: 0 },

    // Vehicle Bill Fields
    purpose: { type: String, trim: true },
    vehicles: [{ type: Schema.Types.ObjectId, ref: "Vehicle" }],

    // Accommodation Bill Fields
    roomNo: { type: String, trim: true },
    note: { type: String, trim: true },
  },
  { timestamps: true }
);

// Indexes
billSchema.index({ billType: 1 });
billSchema.index({ billDate: -1 });
billSchema.index({ shop: 1 });
billSchema.index({ vehicle: 1 });
billSchema.index({ vehicles: 1 });
billSchema.index({ amount: 1 });
billSchema.index({ createdBy: 1 });
billSchema.index({ category: 1 });

export const Bill = model<IBill>("Bill", billSchema);
