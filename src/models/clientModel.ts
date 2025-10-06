import { Document, Schema, model, Types } from "mongoose";

export interface IApartment extends Document {
  number: string;
}

export interface IBuilding extends Document {
  name: string;
  apartments: Types.DocumentArray<IApartment>;
}

export interface ILocation extends Document {
  name: string;
  buildings: Types.DocumentArray<IBuilding>;
}

export interface IClient extends Document {
  clientName: string;
  clientAddress?: string;
  pincode?: string;
  mobileNumber?: string;
  telephoneNumber?: string;
  trnNumber?: string;
  email?: string;
  accountNumber?: string;
  locations: Types.DocumentArray<ILocation>;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const apartmentSchema = new Schema<IApartment>({
  number: {
    type: String,
    required: true,
    trim: true,
  },
});

const buildingSchema = new Schema<IBuilding>({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  apartments: [apartmentSchema],
});

const locationSchema = new Schema<ILocation>({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  buildings: [buildingSchema],
});

const clientSchema = new Schema<IClient>(
  {
    clientName: {
      type: String,
      required: true,
      trim: true,
    },
    clientAddress: {
      type: String,
      required: false,  // Changed from true to false
      trim: true,
    },
    pincode: {
      type: String,
      required: false,  // Changed from true to false
      trim: true,
      
    },
    mobileNumber: {
      type: String,
      required: false,  // Changed from true to false
      trim: true,
      validate: {
        validator: function (v: string) {
          // Only validate if value exists
          return !v || /^\+?[\d\s-]{6,}$/.test(v);
        },
        message: (props: any) => `${props.value} is not a valid phone number!`,
      },
    },
    email: {
      type: String,
      required: false,  // Already was false, keeping it explicit
      trim: true,
      validate: {
        validator: function (v: string) {
          // Only validate if value exists
          return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: (props: any) => `${props.value} is not a valid email!`,
      },
    },
    telephoneNumber: {
      type: String,
      required: false,  // Already was false
      trim: true,
      validate: {
        validator: function (v: string) {
          return !v || /^\+?[\d\s-]{6,}$/.test(v);
        },
        message: (props: any) => `${props.value} is not a valid phone number!`,
      },
    },
    trnNumber: {
      type: String,
      required: false,  // Changed from true to false
      trim: true,
    },
    accountNumber: {
      type: String,
      required: false,  // Already was false
      trim: true,
    },
    locations: {
      type: [locationSchema],
      default: [],  // Provide default empty array
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
clientSchema.index({ clientName: 1 });
clientSchema.index({ trnNumber: 1 });
clientSchema.index({ pincode: 1 });
clientSchema.index({ accountNumber: 1 });

export const Client = model<IClient>("Client", clientSchema);