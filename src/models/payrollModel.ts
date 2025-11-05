import { Document, Schema, model, Types } from "mongoose";

export interface IPayroll extends Document {
  employee: Types.ObjectId;
  labourCard: string;
  labourCardPersonalNo: string;
  period: string;

  // Earnings
  allowance: number;
  transport: number;
  overtime: number;
  specialOT: number;
  medical: number;
  bonus: number;

  // Deductions
  mess: number; // Food Allowance
  salaryAdvance: number;
  loanDeduction: number;
  fineAmount: number;
  visaDeduction: number; // NEW FIELD

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

    // Earnings
    allowance: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    transport: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    overtime: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    specialOT: {
      type: Number,
      default: 0,
    },
    medical: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    bonus: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },

    // Deductions
    mess: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    salaryAdvance: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    loanDeduction: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    fineAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0
    },
    visaDeduction: { // NEW FIELD
      type: Number,
      required: true,
      min: 0,
      default: 0
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
      transform: function (doc, ret) {
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