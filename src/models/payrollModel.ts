import mongoose, { Schema, Document } from 'mongoose';

export interface IPayroll extends Document {
  employee: mongoose.Types.ObjectId;
  labourCard: string;
  labourCardPersonalNo: string;
  period: string;
  transport: number;
  overtime: number;
  specialOT: number;
  medical: number;
  bonus: number;
  mess: number;
  salaryAdvance: number;
  loanDeduction: number;
  fineAmount: number;
  visaDeduction: number;
  // NEW DEDUCTION FIELDS
  otherDeduction1: number;
  otherDeduction2: number;
  otherDeduction3: number;
  net: number;
  remark?: string;
  createdBy: mongoose.Types.ObjectId;
  calculationDetails?: {
    baseSalaryFromAttendance: number;
    sundayBonus: number;
    absentDeduction: number;
    attendanceSummary: {
      totalMonthDays: number;
      totalSundays: number;
      paidLeaveDays: number;
      absentDays: number;
      regularWorkedDays: number;
      sundayWorkingDays: number;
      totalRegularHours: number;
      totalOvertimeHours: number;
      sundayOvertimeHours: number;
      sundayRegularHours: number; // Added for Sunday normal hours
    };
    rates: {
      dailyRate: number;
      overtimeHourlyRate: number;
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
  createdAt: Date;
  updatedAt: Date;
}

const payrollSchema = new Schema<IPayroll>({
  employee: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  labourCard: {
    type: String,
    required: true
  },
  labourCardPersonalNo: {
    type: String,
    required: true
  },
  period: {
    type: String,
    required: true
  },
  transport: {
    type: Number,
    default: 0
  },
  overtime: {
    type: Number,
    default: 0
  },
  specialOT: {
    type: Number,
    default: 0
  },
  medical: {
    type: Number,
    default: 0
  },
  bonus: {
    type: Number,
    default: 0
  },
  mess: {
    type: Number,
    default: 0
  },
  salaryAdvance: {
    type: Number,
    default: 0
  },
  loanDeduction: {
    type: Number,
    default: 0
  },
  fineAmount: {
    type: Number,
    default: 0
  },
  visaDeduction: {
    type: Number,
    default: 0
  },
  // NEW DEDUCTION FIELDS
  otherDeduction1: {
    type: Number,
    default: 0
  },
  otherDeduction2: {
    type: Number,
    default: 0
  },
  otherDeduction3: {
    type: Number,
    default: 0
  },
  net: {
    type: Number,
    required: true
  },
  remark: {
    type: String
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  calculationDetails: {
    type: Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true
});

// Indexes for better performance
payrollSchema.index({ employee: 1, period: 1 }, { unique: true });
payrollSchema.index({ period: 1 });
payrollSchema.index({ labourCard: 1 });
payrollSchema.index({ createdBy: 1 });
payrollSchema.index({ createdAt: 1 });

export const Payroll = mongoose.model<IPayroll>('Payroll', payrollSchema);