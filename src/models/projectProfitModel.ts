import { Document, Schema, model, Types } from "mongoose";

export interface IProjectProfit extends Document {
  projectName: string;
  poNumber: string;
  startDate: Date;
  budget: number;
  expenses: number;
  profit: number;
  description: string;
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

const projectProfitSchema = new Schema<IProjectProfit>(
  {
    projectName: { type: String, required: true },
    poNumber: { type: String, required: true },
    startDate: { type: Date, required: true },
    budget: { type: Number, required: true, min: 0 },
    expenses: { type: Number, required: true, min: 0, default: 0 },
    profit: { type: Number, required: true, default: 0 },
    description: { type: String },
    attachments: [attachmentSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

projectProfitSchema.pre<IProjectProfit>("save", function (next) {
  this.profit = this.budget - this.expenses;
  next();
});

projectProfitSchema.index({ projectName: 1 });
projectProfitSchema.index({ poNumber: 1 });
projectProfitSchema.index({ startDate: 1 });
projectProfitSchema.index({ profit: 1 });
projectProfitSchema.index({ createdBy: 1 });

export const ProjectProfit = model<IProjectProfit>("ProjectProfit", projectProfitSchema);