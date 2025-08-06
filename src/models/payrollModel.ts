import { Document, Schema, model, Types } from "mongoose";

export interface IPayroll extends Document {
  employee: Types.ObjectId;
  labourCard: string;
  labourCardPersonalNo: string;
  period: string; // Format like "01-2023" or "January 2023"
  allowance: number;
  deduction: number;
  mess: number;
  advance: number;
  net: number;
  remark?: string;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const payrollSchema = new Schema<IPayroll>(
  {
    employee: { 
      type: Schema.Types.ObjectId, 
      ref: "User",
      required: true 
    },
    labourCard: { 
      type: String, 
      required: true,
      trim: true
    },
    labourCardPersonalNo: { 
      type: String, 
      required: true,
      trim: true
    },
    period: { 
      type: String, 
      required: true,
      trim: true
    },
    allowance: { 
      type: Number, 
      required: true, 
      min: 0 
    },
    deduction: { 
      type: Number, 
      required: true, 
      min: 0 
    },
    mess: { 
      type: Number, 
      required: true, 
      min: 0 
    },
    advance: { 
      type: Number, 
      required: true, 
      min: 0 
    },
    net: { 
      type: Number, 
      required: true 
    },
    remark: { 
      type: String,
      trim: true
    },
    createdBy: { 
      type: Schema.Types.ObjectId, 
      ref: "User",
      required: true 
    }
  },
  { 
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function(doc, ret) {
        delete ret.__v;
        return ret;
      }
    }
  }
);

// Indexes for optimized queries
payrollSchema.index({ employee: 1 });
payrollSchema.index({ period: 1 });
payrollSchema.index({ createdBy: 1 });
payrollSchema.index({ labourCard: 1 });
payrollSchema.index({ labourCardPersonalNo: 1 });

export const Payroll = model<IPayroll>("Payroll", payrollSchema);