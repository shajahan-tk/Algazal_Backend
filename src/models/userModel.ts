import { Document, Schema, model, Types } from "mongoose";

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  password: string;
  phoneNumbers?: string[];
  firstName: string;
  lastName: string;
  role: string;
  salary?: number;
  isActive?: boolean;
  profileImage?: string;
  signatureImage?: string;
  address?: string;
  accountNumber?: string;
  emiratesId?: string;
  emiratesIdDocument?: string;
  passportNumber?: string;
  passportDocument?: string;
  iBANNumber?: string;
  createdBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    phoneNumbers: {
      type: [String],
      required: false,
      default: [],
    },
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      enum: [
        "super_admin",
        "admin",
        "engineer",
        "finance",
        "driver",
        "worker",
        "supervisor",
      ],
      default: "worker",
    },
    salary: {
      type: Number,
      required: false,
      min: 0,
      validate: {
        validator: function (this: IUser, value: number) {
          if (value === undefined || value === null) return true;
          return ["super_admin", "admin"].includes(this.role || "worker") || value > 0;
        },
        message: "Salary must be greater than 0 for this role",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    profileImage: {
      type: String,
    },
    signatureImage: {
      type: String,
    },
    address: {
      type: String,
      trim: true,
    },
    accountNumber: {
      type: String,
      trim: true,
    },
    emiratesId: {
      type: String,
      trim: true,
    },
    emiratesIdDocument: {
      type: String,
    },
    passportNumber: {
      type: String,
      trim: true,
    },
    passportDocument: {
      type: String,
    },
    iBANNumber: {
      type: String,
      trim: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
    toObject: {
      virtuals: true,
      transform: function (doc, ret) {
        delete ret.password;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Indexes for better query performance
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ firstName: "text", lastName: "text", email: "text" });

export const User = model<IUser>("User", userSchema);