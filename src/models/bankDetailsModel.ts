import { Document, Schema, model } from "mongoose";

export interface IBank extends Document {
  bankName: string;
  accountName: string;
  accountNumber: string;
  iban: string;
  swiftCode: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const bankSchema = new Schema<IBank>(
  {
    bankName: {
      type: String,
      required: true,
      trim: true,
    },
    accountName: {
      type: String,
      required: true,
      trim: true,
    },
    accountNumber: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    iban: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    swiftCode: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

bankSchema.index({ bankName: 1 });
bankSchema.index({ accountNumber: 1 });
bankSchema.index({ iban: 1 });

export const Bank = model<IBank>("Bank", bankSchema);
