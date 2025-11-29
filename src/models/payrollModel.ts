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
  mess: number;
  salaryAdvance: number;
  loanDeduction: number;
  fineAmount: number;
  visaDeduction: number;

  net: number;
  remark?: string;
  createdBy: Types.ObjectId;

  // NEW: Calculation details
  calculationDetails?: {
    baseSalaryFromAttendance: number;
    sundayBonus: number;
    attendanceSummary: {
      totalMonthDays: number;
      totalSundays: number;
      paidLeaveDays: number;
      absentDays: number;
      effectiveWorkingDays: number;
      totalWorkingDays: number;
      totalActualHours: number;
      totalOvertimeHours: number;
      sundayWorkingDays: number;
      sundayOvertimeHours: number;
    };
    rates: {
      dailyRate: number;
      hourlyRate: number;
    };
  };

  createdAt?: Date;
  updatedAt?: Date;
}

const payrollSchema = new Schema(
  {
    employee: { type: Schema.Types.ObjectId, ref: "User", required: true },
    labourCard: { type: String, required: true, trim: true },
    labourCardPersonalNo: { type: String, required: true, trim: true },
    period: { type: String, required: true, trim: true },

    // Earnings
    allowance: { type: Number, required: true, min: 0, default: 0 },
    transport: { type: Number, required: true, min: 0, default: 0 },
    overtime: { type: Number, required: true, min: 0, default: 0 },
    specialOT: { type: Number, default: 0 },
    medical: { type: Number, required: true, min: 0, default: 0 },
    bonus: { type: Number, required: true, min: 0, default: 0 },

    // Deductions
    mess: { type: Number, required: true, min: 0, default: 0 },
    salaryAdvance: { type: Number, required: true, min: 0, default: 0 },
    loanDeduction: { type: Number, required: true, min: 0, default: 0 },
    fineAmount: { type: Number, required: true, min: 0, default: 0 },
    visaDeduction: { type: Number, required: true, min: 0, default: 0 },

    net: { type: Number, required: true },
    remark: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },

    // NEW: Calculation details
    calculationDetails: {
      baseSalaryFromAttendance: { type: Number, default: 0 },
      sundayBonus: { type: Number, default: 0 },
      attendanceSummary: {
        totalMonthDays: { type: Number, default: 0 },
        totalSundays: { type: Number, default: 0 },
        paidLeaveDays: { type: Number, default: 0 },
        absentDays: { type: Number, default: 0 },
        effectiveWorkingDays: { type: Number, default: 0 },
        totalWorkingDays: { type: Number, default: 0 },
        totalActualHours: { type: Number, default: 0 },
        totalOvertimeHours: { type: Number, default: 0 },
        sundayWorkingDays: { type: Number, default: 0 },
        sundayOvertimeHours: { type: Number, default: 0 }
      },
      rates: {
        dailyRate: { type: Number, default: 0 },
        hourlyRate: { type: Number, default: 0 }
      }
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