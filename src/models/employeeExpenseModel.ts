import { Document, Schema, model, Types } from "mongoose";
import { IUser } from "./userModel";

export interface ICustomExpense {
  name: string;
  amount: number;
}

export interface IEmployeeExpense extends Document {
  employee: Types.ObjectId | IUser;
  designation: string;
  country: string;
  basicSalary: number;
  allowance: number;
  totalSalary: number;
  twoYearSalary: number;
  perYearExpenses: number;
  perMonthExpenses: number;
  perDayExpenses: number;
  totalExpensesPerPerson: number;
  visaExpenses: number;
  twoYearUniform: number;
  shoes: number;
  twoYearAccommodation: number;
  sewaBills: number;
  dewaBills: number;
  insurance: number;
  transport: number;
  water: number;
  thirdPartyLiabilities: number;
  fairmontCertificate: number;
  leaveSalary: number;
  ticket: number;
  gratuity: number;
  customExpenses: ICustomExpense[];
  createdBy: Types.ObjectId | IUser;
  createdAt?: Date;
  updatedAt?: Date;
}

const customExpenseSchema = new Schema<ICustomExpense>({
  name: { type: String, required: true },
  amount: { type: Number, required: true, min: 0 }
});

const employeeExpenseSchema = new Schema<IEmployeeExpense>(
  {
    employee: { 
      type: Schema.Types.ObjectId, 
      ref: "User",
      required: true 
    },
    designation: { type: String, required: true },
    country: { type: String, required: true },
    basicSalary: { type: Number, required: true, min: 0 },
    allowance: { type: Number, required: true, min: 0 },
    totalSalary: { type: Number, required: true, min: 0 },
    twoYearSalary: { type: Number, required: true, min: 0 },
    perYearExpenses: { type: Number, required: true, min: 0 },
    perMonthExpenses: { type: Number, required: true, min: 0 },
    perDayExpenses: { type: Number, required: true, min: 0 },
    totalExpensesPerPerson: { type: Number, required: true, min: 0 },
    visaExpenses: { type: Number, required: true, min: 0 },
    twoYearUniform: { type: Number, required: true, min: 0 },
    shoes: { type: Number, required: true, min: 0 },
    twoYearAccommodation: { type: Number, required: true, min: 0 },
    sewaBills: { type: Number, required: true, min: 0 },
    dewaBills: { type: Number, required: true, min: 0 },
    insurance: { type: Number, required: true, min: 0 },
    transport: { type: Number, required: true, min: 0 },
    water: { type: Number, required: true, min: 0 },
    thirdPartyLiabilities: { type: Number, required: true, min: 0 },
    fairmontCertificate: { type: Number, required: true, min: 0 },
    leaveSalary: { type: Number, required: true, min: 0 },
    ticket: { type: Number, required: true, min: 0 },
    gratuity: { type: Number, required: true, min: 0 },
    customExpenses: [customExpenseSchema],
    createdBy: { 
      type: Schema.Types.ObjectId, 
      ref: "User",
      required: true 
    },
  },
  { timestamps: true }
);

// Indexes for better query performance
employeeExpenseSchema.index({ employee: 1 });
employeeExpenseSchema.index({ designation: 1 });
employeeExpenseSchema.index({ country: 1 });
employeeExpenseSchema.index({ createdAt: -1 });

// Middleware to calculate derived fields before saving
employeeExpenseSchema.pre<IEmployeeExpense>("save", function(next) {
  // Calculate total salary if not provided
  if (this.isModified("basicSalary") || this.isModified("allowance")) {
    this.totalSalary = this.basicSalary + this.allowance;
  }
  
  // You can add more automatic calculations here if needed
  next();
});

export const EmployeeExpense = model<IEmployeeExpense>("EmployeeExpense", employeeExpenseSchema);