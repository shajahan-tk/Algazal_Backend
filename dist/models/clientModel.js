"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Client = void 0;
const mongoose_1 = require("mongoose");
const apartmentSchema = new mongoose_1.Schema({
    number: {
        type: String,
        required: true,
        trim: true,
    },
});
const buildingSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    apartments: [apartmentSchema],
});
const locationSchema = new mongoose_1.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    buildings: [buildingSchema],
});
const clientSchema = new mongoose_1.Schema({
    clientName: {
        type: String,
        required: true,
        trim: true,
    },
    clientAddress: {
        type: String,
        required: false, // Changed from true to false
        trim: true,
    },
    pincode: {
        type: String,
        required: false, // Changed from true to false
        trim: true,
    },
    mobileNumber: {
        type: String,
        required: false, // Changed from true to false
        trim: true,
        validate: {
            validator: function (v) {
                // Only validate if value exists
                return !v || /^\+?[\d\s-]{6,}$/.test(v);
            },
            message: (props) => `${props.value} is not a valid phone number!`,
        },
    },
    email: {
        type: String,
        required: false, // Already was false, keeping it explicit
        trim: true,
        validate: {
            validator: function (v) {
                // Only validate if value exists
                return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            },
            message: (props) => `${props.value} is not a valid email!`,
        },
    },
    telephoneNumber: {
        type: String,
        required: false, // Already was false
        trim: true,
        validate: {
            validator: function (v) {
                return !v || /^\+?[\d\s-]{6,}$/.test(v);
            },
            message: (props) => `${props.value} is not a valid phone number!`,
        },
    },
    trnNumber: {
        type: String,
        required: false, // Changed from true to false
        trim: true,
    },
    accountNumber: {
        type: String,
        required: false, // Already was false
        trim: true,
    },
    locations: {
        type: [locationSchema],
        default: [], // Provide default empty array
    },
    createdBy: {
        type: mongoose_1.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
}, { timestamps: true });
// Indexes
clientSchema.index({ clientName: 1 });
clientSchema.index({ trnNumber: 1 });
clientSchema.index({ pincode: 1 });
clientSchema.index({ accountNumber: 1 });
exports.Client = (0, mongoose_1.model)("Client", clientSchema);
//# sourceMappingURL=clientModel.js.map