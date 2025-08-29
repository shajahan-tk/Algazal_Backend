"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VisaExpense = void 0;
const mongoose_1 = require("mongoose");
const visaExpenseSchema = new mongoose_1.Schema({
    employee: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
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
    createdBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true },
}, { timestamps: true });
// Indexes for better query performance
visaExpenseSchema.index({ employee: 1 });
visaExpenseSchema.index({ createdBy: 1 });
visaExpenseSchema.index({ createdAt: -1 });
exports.VisaExpense = (0, mongoose_1.model)("VisaExpense", visaExpenseSchema);
//# sourceMappingURL=visaExpenseModel.js.map