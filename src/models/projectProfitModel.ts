import { Document, Schema, model, Types } from "mongoose";

export interface IProjectProfit extends Document {
  project: Types.ObjectId; // Reference to Project
  
  // Denormalized data for historical accuracy
  projectName: string;
  projectNumber: string;
  clientName: string;
  location: string;
  building: string;
  apartmentNumber: string;
  
  // LPO details - only store reference, not the number
  lpoId?: Types.ObjectId;
  
  // Report period
  reportMonth: Date;
  reportPeriodStart: Date;
  reportPeriodEnd: Date;
  
  // Financial data
  budget: number;
  expenses: number;
  profit: number;
  
  description?: string;
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
    project: { 
      type: Schema.Types.ObjectId, 
      ref: "Project", 
      required: true 
    },
    
    // Denormalized fields (stored for historical accuracy)
    projectName: { type: String, required: true },
    projectNumber: { type: String, required: true },
    clientName: { type: String, required: true },
    location: { type: String, required: true },
    building: { type: String, required: true },
    apartmentNumber: { type: String, required: true },
    
    // LPO details - only store reference ID
    lpoId: { type: Schema.Types.ObjectId, ref: "LPO" },
    
    // Report period
    reportMonth: { type: Date, required: true },
    reportPeriodStart: { type: Date, required: true },
    reportPeriodEnd: { type: Date, required: true },
    
    // Financial data
    budget: { type: Number, required: true, min: 0 },
    expenses: { type: Number, required: true, min: 0, default: 0 },
    profit: { type: Number, required: true, default: 0 },
    
    description: { type: String },
    attachments: [attachmentSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Auto-calculate profit before saving
projectProfitSchema.pre<IProjectProfit>("save", function (next) {
  this.profit = this.budget - this.expenses;
  next();
});

// Indexes
projectProfitSchema.index({ project: 1, reportMonth: 1 });
projectProfitSchema.index({ projectName: 1 });
projectProfitSchema.index({ reportMonth: 1 });
projectProfitSchema.index({ profit: 1 });
projectProfitSchema.index({ createdBy: 1 });
projectProfitSchema.index({ lpoId: 1 }); // Index for LPO reference

export const ProjectProfit = model<IProjectProfit>("ProjectProfit", projectProfitSchema);