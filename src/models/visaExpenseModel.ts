import { Document, Schema, model, Types } from "mongoose";

export interface IVisaExpense extends Document {
  employee: Types.ObjectId;
  iBan: string;
  passportNumber: string;
  passportExpireDate: Date;
  emirateIdNumber: string;
  emirateIdExpireDate: Date;
  labourCardPersonalNumber: string;
  workPermitNumber: string;
  labourExpireDate: Date;
  offerLetterTyping: number;
  labourInsurance: number;
  labourCardPayment: number;
  statusChangeInOut: number;
  insideEntry: number;
  medicalSharjah: number;
  tajweehSubmission: number;
  iloeInsurance: number;
  healthInsurance: number;
  emirateId: number;
  residenceStamping: number;
  srilankaCouncilHead: number;
  upscoding: number;
  labourFinePayment: number;
  labourCardRenewalPayment: number;
  servicePayment: number;
  visaStamping: number;
  twoMonthVisitingVisa: number;
  finePayment: number;
  entryPermitOutside: number;
  complaintEmployee: number;
  arabicLetter: number;
  violationCommittee: number;
  quotaModification: number;
  others: number;
  total: number;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const visaExpenseSchema = new Schema<IVisaExpense>(
  {
    employee: { type: Schema.Types.ObjectId, ref: "User", required: true },
    iBan: { type: String, trim: true },
    passportNumber: { type: String, trim: true },
    passportExpireDate: { type: Date },
    emirateIdNumber: { type: String, trim: true },
    emirateIdExpireDate: { type: Date },
    labourCardPersonalNumber: { type: String, trim: true },
    workPermitNumber: { type: String, trim: true },
    labourExpireDate: { type: Date },
    offerLetterTyping: { type: Number, default: 0, min: 0 },
    labourInsurance: { type: Number, default: 0, min: 0 },
    labourCardPayment: { type: Number, default: 0, min: 0 },
    statusChangeInOut: { type: Number, default: 0, min: 0 },
    insideEntry: { type: Number, default: 0, min: 0 },
    medicalSharjah: { type: Number, default: 0, min: 0 },
    tajweehSubmission: { type: Number, default: 0, min: 0 },
    iloeInsurance: { type: Number, default: 0, min: 0 },
    healthInsurance: { type: Number, default: 0, min: 0 },
    emirateId: { type: Number, default: 0, min: 0 },
    residenceStamping: { type: Number, default: 0, min: 0 },
    srilankaCouncilHead: { type: Number, default: 0, min: 0 },
    upscoding: { type: Number, default: 0, min: 0 },
    labourFinePayment: { type: Number, default: 0, min: 0 },
    labourCardRenewalPayment: { type: Number, default: 0, min: 0 },
    servicePayment: { type: Number, default: 0, min: 0 },
    visaStamping: { type: Number, default: 0, min: 0 },
    twoMonthVisitingVisa: { type: Number, default: 0, min: 0 },
    finePayment: { type: Number, default: 0, min: 0 },
    entryPermitOutside: { type: Number, default: 0, min: 0 },
    complaintEmployee: { type: Number, default: 0, min: 0 },
    arabicLetter: { type: Number, default: 0, min: 0 },
    violationCommittee: { type: Number, default: 0, min: 0 },
    quotaModification: { type: Number, default: 0, min: 0 },
    others: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true }
);

// Indexes for better query performance
visaExpenseSchema.index({ employee: 1 });
visaExpenseSchema.index({ createdBy: 1 });
visaExpenseSchema.index({ createdAt: -1 });

export const VisaExpense = model<IVisaExpense>("VisaExpense", visaExpenseSchema);