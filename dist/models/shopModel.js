"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Shop = void 0;
const mongoose_1 = require("mongoose");
const shopAttachmentSchema = new mongoose_1.Schema({
    fileName: { type: String, required: true },
    fileType: { type: String, required: true },
    filePath: { type: String, required: true },
});
const shopSchema = new mongoose_1.Schema({
    shopName: {
        type: String,
        required: true,
        trim: true,
    },
    shopNo: {
        type: String,
        required: false, // Made optional
        trim: true,
        unique: true,
        sparse: true, // Allow multiple null/undefined values
    },
    address: {
        type: String,
        required: true,
        trim: true,
    },
    vat: {
        type: String,
        required: false,
        trim: true,
    },
    ownerName: {
        type: String,
        required: false,
        trim: true,
    },
    ownerEmail: {
        type: String,
        required: false,
        trim: true,
        validate: {
            validator: function (v) {
                return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: (props) => `${props.value} is not a valid email!`,
        },
    },
    contact: {
        type: String,
        required: false, // Made optional
        trim: true,
        validate: {
            validator: function (v) {
                return !v || /^\+?[\d\s-]{6,}$/.test(v);
            },
            message: (props) => `${props.value} is not a valid phone number!`,
        },
    },
    shopAttachments: [shopAttachmentSchema],
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });
// Indexes
shopSchema.index({ shopName: 1 });
shopSchema.index({ address: "text" });
exports.Shop = (0, mongoose_1.model)("Shop", shopSchema);
//# sourceMappingURL=shopModel.js.map