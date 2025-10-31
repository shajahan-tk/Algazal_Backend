import { Document, Schema, model, Types } from "mongoose";

export interface IAttendance extends Document {
  project?: Types.ObjectId; // Make optional for normal type and day off
  user: Types.ObjectId;
  date: Date;
  present: boolean;
  isPaidLeave: boolean; // NEW: Flag for day off/paid leave
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
        // Project is required only for project type AND when not a paid leave
        return this.type === "project" && !this.isPaidLeave;
      },
      validate: {
        validator: function(value: Types.ObjectId | undefined) {
          // Project must NOT exist when isPaidLeave is true
          if (this.isPaidLeave && value) {
            return false;
          }
          return true;
        },
        message: "Paid leave cannot be associated with a project"
      }
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
    isPaidLeave: {
      type: Boolean,
      default: false,
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
  // For paid leave (day off), set hours to 0 and no project
  if (this.isPaidLeave) {
    this.workingHours = 0;
    this.overtimeHours = 0;
    this.project = undefined;
  } else if (this.isModified("workingHours")) {
    const basicHours = 10;
    this.overtimeHours = Math.max(0, this.workingHours - basicHours);
  }
  next();
});

// Indexes remain the same
attendanceSchema.index(
  { project: 1, user: 1, date: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "project" },
    name: "project_attendance_unique"
  }
);

attendanceSchema.index(
  { user: 1, date: 1, type: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "normal" },
    name: "normal_attendance_unique"
  }
);

attendanceSchema.index({ user: 1, date: 1 }, { name: "user_date_lookup" });
attendanceSchema.index({ user: 1, type: 1, date: 1 }, { name: "user_type_date_lookup" });
attendanceSchema.index({ project: 1, date: 1 }, { name: "project_date_lookup" });
attendanceSchema.index({ date: 1, type: 1 }, { name: "date_type_lookup" });

export const Attendance = model<IAttendance>("Attendance", attendanceSchema);