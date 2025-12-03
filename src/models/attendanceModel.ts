import { Document, Schema, model, Types } from "mongoose";

export interface IAttendance extends Document {
  projects: {
    project: Types.ObjectId;
    workingHours: number;
    markedBy: Types.ObjectId;
    present: boolean;
  }[];
  project?: Types.ObjectId; // Deprecated: Kept for backward compatibility during migration
  user: Types.ObjectId;
  date: Date;
  present: boolean;
  isPaidLeave: boolean;
  markedBy: Types.ObjectId; // This field is still needed for normal/paid leave entries
  type: "project" | "normal";
  workingHours: number; // Total daily working hours
  overtimeHours: number; // Total daily overtime hours
  createdAt: Date;
}

const attendanceSchema = new Schema<IAttendance>(
  {
    projects: [
      {
        project: {
          type: Schema.Types.ObjectId,
          ref: "Project",
          required: true,
        },
        workingHours: {
          type: Number,
          required: true,
          min: 0,
          default: 0,
        },
        markedBy: {
          type: Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        present: {
          type: Boolean,
          default: true
        }
      },
    ],
    // Deprecated field, kept for reference or migration
    project: {
      type: Schema.Types.ObjectId,
      ref: "Project",
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

// Calculate overtime and totals before saving
attendanceSchema.pre<IAttendance>("save", function (next) {
  // For paid leave (day off), set hours to 0 and clear projects
  if (this.isPaidLeave) {
    this.workingHours = 0;
    this.overtimeHours = 0;
    this.projects = [];
    this.project = undefined;
    this.present = false; // Important: Paid leave should be marked as absent
  } else {
    // Calculate total working hours from projects array
    if (this.projects && this.projects.length > 0) {
      const totalProjectHours = this.projects.reduce(
        (sum, p) => sum + (p.workingHours || 0),
        0
      );
      this.workingHours = totalProjectHours;

      // Set project field to first project for backward compatibility
      this.project = this.projects[0]?.project;
    }

    // Calculate overtime properly
    const basicHours = 10; // 10 hours is the threshold for overtime
    const dailyHours = this.workingHours || 0;

    // Only calculate overtime if present and has working hours
    if (this.present && dailyHours > 0) {
      this.overtimeHours = Math.max(0, dailyHours - basicHours);
    } else {
      this.overtimeHours = 0;
    }
  }

  next();
});

// Indexes
// Modified unique index: User + Date + Type should be unique.
// We no longer include 'project' in the unique index because multiple projects are now in one document.
attendanceSchema.index(
  { user: 1, date: 1, type: 1 },
  {
    unique: true,
    name: "user_date_type_unique"
  }
);

attendanceSchema.index({ user: 1, date: 1 }, { name: "user_date_lookup" });
attendanceSchema.index({ "projects.project": 1, date: 1 }, { name: "project_date_lookup" });
attendanceSchema.index({ date: 1, type: 1 }, { name: "date_type_lookup" });

export const Attendance = model<IAttendance>("Attendance", attendanceSchema);