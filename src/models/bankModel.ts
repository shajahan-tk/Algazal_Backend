import { Document, Schema, model, Types } from "mongoose";

export interface IBankAttachment extends Document {
  fileName: string;
  fileType: string;
  filePath: string;
}

export type BankReportType = "adib" | "expense";

export interface IBankReport extends Document {
  reportType: BankReportType;
  reportDate: Date;
  amount: number;
  remarks?: string;
  attachments: Types.DocumentArray<IBankAttachment>;
  createdBy: Types.ObjectId;

  // ADIB Report Fields
  category?: Types.ObjectId;
  shop?: Types.ObjectId;

  // Expense Report Fields
  description?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

const bankAttachmentSchema = new Schema<IBankAttachment>({
  fileName: { type: String, required: true },
  fileType: { type: String, required: true },
  filePath: { type: String, required: true },
});

const bankReportSchema = new Schema<IBankReport>(
  {
    reportType: {
      type: String,
      required: true,
      enum: ["adib", "expense"],
    },
    reportDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    remarks: { type: String, trim: true },
    attachments: [bankAttachmentSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // ADIB Report Fields
    category: { type: Schema.Types.ObjectId, ref: "Category" },
    shop: { type: Schema.Types.ObjectId, ref: "Shop" },

    // Expense Report Fields
    description: { type: String, trim: true },
  },
  { timestamps: true }
);

// Indexes
bankReportSchema.index({ reportType: 1 });
bankReportSchema.index({ reportDate: -1 });
bankReportSchema.index({ amount: 1 });
bankReportSchema.index({ createdBy: 1 });
bankReportSchema.index({ category: 1 });
bankReportSchema.index({ shop: 1 });

export const BankReport = model<IBankReport>("BankReport", bankReportSchema);
