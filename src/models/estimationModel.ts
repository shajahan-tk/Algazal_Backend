import { Document, Schema, model, Types } from "mongoose";
import { IProject } from "./projectModel";
import { IUser } from "./userModel";

interface IEstimationItem {
  description: string;
  uom: string; // Added UOM field
  quantity: number;
  unitPrice: number;
  total: number;
}
interface ITermsITem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface ILabourItem {
  designation: string;
  days: number;
  price: number;
  total: number;
}

export interface IEstimation extends Document {
  project: Types.ObjectId | IProject;
  estimationNumber: string;
  workStartDate?: Date; // Changed to optional
  workEndDate?: Date; // Changed to optional
  workDays?: number; // Changed to optional
  dailyStartTime?: string; // Changed to optional
  dailyEndTime?: string; // Changed to optional
  validUntil: Date;
  paymentDueBy: number;
  subject?: string;
  materials: IEstimationItem[];
  labour: ILabourItem[];
  termsAndConditions: ITermsITem[];
  estimatedAmount: number;
  quotationAmount?: number;
  commissionAmount?: number;
  profit?: number;
  preparedBy: Types.ObjectId | IUser;
  checkedBy?: Types.ObjectId | IUser;
  approvedBy?: Types.ObjectId | IUser;
  isChecked: boolean;
  isApproved: boolean;
  approvalComment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const estimationItemSchema = new Schema<IEstimationItem>({
  description: { type: String, required: true },
  uom: { type: String, required: true }, // Added UOM field
  quantity: { type: Number, required: true, min: 0 },
  unitPrice: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
});
const termItemSchema = new Schema<ITermsITem>({
  description: { type: String, required: true },
  quantity: { type: Number, required: true, min: 0 },
  unitPrice: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
});

const labourItemSchema = new Schema<ILabourItem>({
  designation: { type: String, required: true },
  days: { type: Number, required: true, min: 0 },
  price: { type: Number, required: true, min: 0 },
  total: { type: Number, required: true, min: 0 },
});

const estimationSchema = new Schema<IEstimation>(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: true,
    },
    estimationNumber: {
      type: String,
      required: true,
    },
    workStartDate: {
      type: Date,
      // Removed required: true
    },
    workEndDate: {
      type: Date,
      // Removed required: true
      // Removed validation that depends on workStartDate
    },
    workDays: {
      type: Number,
      min: 0, // Changed from min: 1 to min: 0
      default: 0,
    },
    dailyStartTime: {
      type: String,
      // Removed required: true
      default: "09:00",
      validate: {
        validator: function (v: string) {
          if (!v) return true; // Allow empty/null
          return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
        },
        message: "Invalid time format. Use HH:mm format (e.g., 09:00)"
      }
    },
    dailyEndTime: {
      type: String,
      // Removed required: true
      default: "18:00",
      validate: {
        validator: function (v: string) {
          if (!v) return true; // Allow empty/null
          return /^([01]\d|2[0-3]):([0-5]\d)$/.test(v);
        },
        message: "Invalid time format. Use HH:mm format (e.g., 18:00)"
      }
    },
    validUntil: {
      type: Date,
      required: true,
    },
    paymentDueBy: {
      type: Number,
      required: true,
      min: 0,
    },
    subject: {
      type: String,
    },
    materials: [estimationItemSchema],
    labour: [labourItemSchema],
    termsAndConditions: [termItemSchema],
    estimatedAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    quotationAmount: {
      type: Number,
      min: 0,
    },
    commissionAmount: {
      type: Number,
      min: 0,
    },
    profit: {
      type: Number,
    },
    preparedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    checkedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    isChecked: {
      type: Boolean,
      default: false,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    approvalComment: {
      type: String,
    },
  },
  { timestamps: true }
);

// Update pre-save hook to handle optional dates
estimationSchema.pre<IEstimation>("save", function (next) {
  const materialsTotal = this.materials.reduce(
    (sum, item) => sum + (item.total || 0),
    0
  );
  const labourTotal = this.labour.reduce(
    (sum, item) => sum + (item.total || 0),
    0
  );
  const termsTotal = this.termsAndConditions.reduce(
    (sum, item) => sum + (item.total || 0),
    0
  );

  this.estimatedAmount = materialsTotal + labourTotal + termsTotal;

  if (this.quotationAmount) {
    this.profit =
      this.quotationAmount -
      this.estimatedAmount -
      (this.commissionAmount || 0);
  }

  // Calculate workDays if both dates are provided
  if (this.workStartDate && this.workEndDate) {
    const start = new Date(this.workStartDate);
    const end = new Date(this.workEndDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    this.workDays = Math.max(0, diffDays) || 0;
  }

  next();
});

estimationSchema.index({ project: 1 });
estimationSchema.index({ estimationNumber: 1 });
estimationSchema.index({ isApproved: 1 });
estimationSchema.index({ isChecked: 1 });
estimationSchema.index({ workStartDate: 1 });
estimationSchema.index({ workEndDate: 1 });

export const Estimation = model<IEstimation>("Estimation", estimationSchema);