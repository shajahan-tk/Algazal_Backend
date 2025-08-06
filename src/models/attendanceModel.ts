import { Document, Schema, model, Types } from "mongoose";

export interface IAttendance extends Document {
  project?: Types.ObjectId; // Make optional for normal type
  user: Types.ObjectId;
  date: Date;
  present: boolean;
  markedBy: Types.ObjectId;
  type: "project" | "normal";
  workingHours: number;
  overtimeHours: number;
  createdAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    project: {
      type: Schema.Types.ObjectId,
      ref: "Project",
      required: function () {
        return this.type === "project";
      },
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    date: {
      type: Date,
      required: true,
      default: Date.now(),
    },
    present: {
      type: Boolean,
      required: true,
    },
    markedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: ["project", "normal"],
      required: true,
      default: "project",
    },
    workingHours: {
      type: Number,
      required: true,
      min: 0,
      max: 24,
      default: 0,
    },
    overtimeHours: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { timestamps: true }
);

// Calculate overtime before saving
attendanceSchema.pre<IAttendance>("save", function (next) {
  if (this.isModified("workingHours")) {
    const basicHours = 10;
    this.overtimeHours = Math.max(0, this.workingHours - basicHours);
  }
  next();
});

// Compound index for quick lookups (only for project type)
attendanceSchema.index(
  { project: 1, user: 1, date: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "project" },
  }
);

export const Attendance = model<IAttendance>("Attendance", attendanceSchema);
