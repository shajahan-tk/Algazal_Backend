import { Document, Schema, model, Types } from "mongoose";

export interface IShopAttachment extends Document {
  fileName: string;
  fileType: string;
  filePath: string;
}

export interface IShop extends Document {
  shopName: string;
  shopNo: string;
  address: string; // Simplified to string
  vat?: string; // Made optional
  ownerName?: string; // Made optional
  ownerEmail?: string;
  contact: string;
  shopAttachments: Types.DocumentArray<IShopAttachment>;
  createdBy: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

const shopAttachmentSchema = new Schema<IShopAttachment>({
  fileName: { type: String, required: true },
  fileType: { type: String, required: true },
  filePath: { type: String, required: true },
});

const shopSchema = new Schema<IShop>(
  {
    shopName: {
      type: String,
      required: true,
      trim: true,
    },
    shopNo: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    vat: {
      type: String,
      required: false, // Made optional
      trim: true,
      sparse: true, // Allows multiple null/undefined values for unique index
      validate: {
        validator: function (v: string) {
          // Only validate if value exists (not null/undefined/empty)
          return !v || v.trim().length > 0;
        },
        message: "VAT number cannot be empty if provided",
      },
    },
    ownerName: {
      type: String,
      required: false, // Made optional
      trim: true,
    },
    ownerEmail: {
      type: String,
      required: false,
      trim: true,
      validate: {
        validator: function (v: string) {
          return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: (props: any) => `${props.value} is not a valid email!`,
      },
    },
    contact: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (v: string) {
          return /^\+?[\d\s-]{6,}$/.test(v);
        },
        message: (props: any) => `${props.value} is not a valid phone number!`,
      },
    },
    shopAttachments: [shopAttachmentSchema],
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

// Indexes
shopSchema.index({ shopName: 1 });
shopSchema.index({ vat: 1 }, { sparse: true }); // Sparse index for optional unique field
shopSchema.index({ shopNo: 1 });
shopSchema.index({ ownerName: 1 });
shopSchema.index({ address: "text" }); // Text index for address search

export const Shop = model<IShop>("Shop", shopSchema);