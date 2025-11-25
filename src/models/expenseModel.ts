// src/models/expenseModel.ts

import { Document, Schema, model, Types } from "mongoose";
import { IProject } from "./projectModel";
import { IUser } from "./userModel";

export interface IMaterialItem {
  description: string;
  date: Date;
  invoiceNo: string;
  amount: number;
  _id?: Types.ObjectId;
  supplierName?: string;
  supplierMobile?: string;
  supplierEmail?: string;
  documentUrl?: string;
  documentKey?: string;
}

// CHANGE: Added 'date' field to the interface
export interface IMiscellaneousExpense {
  description: string;
  date: Date; // <-- ADDED
  quantity: number;
  unitPrice: number;
  total: number;
  _id?: Types.ObjectId;
}

export interface IWorkerLabor {
  user: Types.ObjectId | IUser;
  daysPresent: number;
  dailySalary: number;
  totalSalary: number;
  _id?: Types.ObjectId;
}

export interface IDriverLabor {
  user: Types.ObjectId | IUser;
  daysPresent: number;
  dailySalary: number;
  totalSalary: number;
}

export interface IExpense extends Document {
  project: Types.ObjectId | IProject;
  materials: IMaterialItem[];
  totalMaterialCost: number;
  miscellaneous: IMiscellaneousExpense[];
  totalMiscellaneousCost: number;
  laborDetails: {
    workers: IWorkerLabor[];
    drivers: IDriverLabor[];
    totalLaborCost: number;
  };
  createdBy: Types.ObjectId | IUser;
  createdAt?: Date;
  updatedAt?: Date;
}

const expenseSchema = new Schema<IExpense>(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    materials: [
      {
        description: { type: String, required: true },
        date: { type: Date, required: true, default: Date.now },
        invoiceNo: { type: String, required: true },
        amount: { type: Number, required: true, min: 0 },
        supplierName: { type: String, required: false },
        supplierMobile: { type: String, required: false },
        supplierEmail: { type: String, required: false },
        documentUrl: { type: String, required: false },
        documentKey: { type: String, required: false },
      },
    ],
    totalMaterialCost: { type: Number, default: 0 },
    // CHANGE: Added 'date' field to the schema
    miscellaneous: [
      {
        description: { type: String, required: true },
        date: { type: Date, required: true, default: Date.now }, // <-- ADDED
        quantity: { type: Number, required: true, min: 0 },
        unitPrice: { type: Number, required: true, min: 0 },
        total: { type: Number, required: true, min: 0 },
      },
    ],
    totalMiscellaneousCost: { type: Number, default: 0 },
    laborDetails: {
      workers: [
        {
          user: { type: Schema.Types.ObjectId, ref: "User", required: true },
          daysPresent: { type: Number, required: true, min: 0 },
          dailySalary: { type: Number, required: true, min: 0 },
          totalSalary: { type: Number, required: true, min: 0 },
        },
      ],
      drivers: [
        {
          user: { type: Schema.Types.ObjectId, ref: "User", required: true },
          daysPresent: { type: Number, required: true, min: 0 },
          dailySalary: { type: Number, required: true, min: 0 },
          totalSalary: { type: Number, required: true, min: 0 },
        },
      ],
      totalLaborCost: { type: Number, default: 0 },
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

expenseSchema.pre<IExpense>("save", function (next) {
  this.totalMaterialCost = this.materials.reduce(
    (sum, material) => sum + material.amount,
    0
  );

  this.totalMiscellaneousCost = this.miscellaneous.reduce(
    (sum, misc) => sum + misc.total,
    0
  );

  const workersTotal = this.laborDetails.workers.reduce(
    (sum, worker) => sum + worker.totalSalary,
    0
  );
  const driversTotal = this.laborDetails.drivers.reduce(
    (sum, driver) => sum + driver.totalSalary,
    0
  );
  this.laborDetails.totalLaborCost = workersTotal + driversTotal;

  next();
});

export const Expense = model<IExpense>("Expense", expenseSchema);