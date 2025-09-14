import { Document, Schema, model, Types } from "mongoose";

export interface IShopAttachment extends Document {
  fileName: string;
  fileType: string;
  filePath: string;
}

export interface IShop extends Document {
  shopName: string;
  shopNo?: string; // Made optional
  address: string;
  vat?: string;
  ownerName?: string;
  ownerEmail?: string;
  contact?: string; // Made optional
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
        validator: function (v: string) {
          return !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: (props: any) => `${props.value} is not a valid email!`,
      },
    },
    contact: {
      type: String,
      required: false, // Made optional
      trim: true,
      validate: {
        validator: function (v: string) {
          return !v || /^\+?[\d\s-]{6,}$/.test(v);
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

shopSchema.index({ address: "text" });

export const Shop = model<IShop>("Shop", shopSchema);