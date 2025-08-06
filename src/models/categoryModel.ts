  import { Document, Schema, model, Types } from "mongoose";

  export interface ICategory extends Document {
    name: string;
    description?: string;
    createdBy: Types.ObjectId;
    createdAt?: Date;
    updatedAt?: Date;
  }

  const categorySchema = new Schema<ICategory>(
    {
      name: {
        type: String,
        required: true,
        trim: true,
        unique: true,
      },
      description: {
        type: String,
        trim: true,
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
  categorySchema.index({ name: 1 });
  categorySchema.index({ createdBy: 1 });

  export const Category = model<ICategory>("Category", categorySchema);
