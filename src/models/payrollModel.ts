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

  // Calculation details
  calculationDetails?: {
    baseSalaryFromAttendance: number;
    sundayBonus: number;
    absentDeduction: number; // NEW FIELD
    attendanceSummary: {
      totalMonthDays: number;
      totalSundays: number;
      paidLeaveDays: number;
      absentDays: number;
      regularWorkedDays: number;
      totalWorkingDays: number;
      totalActualHours: number;
      totalOvertimeHours: number;
      sundayWorkingDays: number;
      sundayOvertimeHours: number;
    };
    rates: {
      dailyRate: number;
      overtimeHourlyRate: number; // Changed from hourlyRate to overtimeHourlyRate
    };
    calculationBreakdown: {
      baseSalary: {
        basic: number;
        allowance: number;
        total: number;
        note: string;
      };
      sundayBonus: {
        days: number;
        dailyRate: number;
        amount: number;
        rule: string;
      };
      regularOvertime: {
        hours: number;
        rate: number;
        amount: number;
      };
      sundayOvertime: {
        hours: number;
        rate: number;
        amount: number;
      };
      absentDeduction: {
        days: number;
        dailyRate: number;
        amount: number;
        rule: string;
      };
      paidLeave: {
        days: number;
        note: string;
      };
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

    // Calculation details
    calculationDetails: {
      baseSalaryFromAttendance: { type: Number, default: 0 },
      sundayBonus: { type: Number, default: 0 },
      absentDeduction: { type: Number, default: 0 }, // NEW FIELD
      attendanceSummary: {
        totalMonthDays: { type: Number, default: 0 },
        totalSundays: { type: Number, default: 0 },
        paidLeaveDays: { type: Number, default: 0 },
        absentDays: { type: Number, default: 0 },
        regularWorkedDays: { type: Number, default: 0 },
        totalWorkingDays: { type: Number, default: 0 },
        totalActualHours: { type: Number, default: 0 },
        totalOvertimeHours: { type: Number, default: 0 },
        sundayWorkingDays: { type: Number, default: 0 },
        sundayOvertimeHours: { type: Number, default: 0 }
      },
      rates: {
        dailyRate: { type: Number, default: 0 },
        overtimeHourlyRate: { type: Number, default: 0 } // Changed from hourlyRate
      },
      calculationBreakdown: {
        baseSalary: {
          basic: { type: Number, default: 0 },
          allowance: { type: Number, default: 0 },
          total: { type: Number, default: 0 },
          note: { type: String, default: "Full monthly salary (basic + allowance)" }
        },
        sundayBonus: {
          days: { type: Number, default: 0 },
          dailyRate: { type: Number, default: 0 },
          amount: { type: Number, default: 0 },
          rule: { type: String, default: "Any hours worked on Sunday = Full day bonus" }
        },
        regularOvertime: {
          hours: { type: Number, default: 0 },
          rate: { type: Number, default: 0 },
          amount: { type: Number, default: 0 }
        },
        sundayOvertime: {
          hours: { type: Number, default: 0 },
          rate: { type: Number, default: 0 },
          amount: { type: Number, default: 0 }
        },
        absentDeduction: {
          days: { type: Number, default: 0 },
          dailyRate: { type: Number, default: 0 },
          amount: { type: Number, default: 0 },
          rule: { type: String, default: "Absent days deducted from base salary" }
        },
        paidLeave: {
          days: { type: Number, default: 0 },
          note: { type: String, default: "No pay, no bonus, no deduction from base salary" }
        }
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