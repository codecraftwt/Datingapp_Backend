const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
    },
    gender: {
      type: String,
      required: [true, 'Gender is required'],
      enum: ['Male', 'Women', 'Female', 'Non-binary'],
    },
    mobile: {
      type: String,
      required: [true, 'Mobile number is required'],
      unique: true,
      trim: true,
    },
    firstName: { type: String, trim: true },
    bdayDay: { type: String },
    bdayMonth: { type: String },
    bdayYear: { type: String },
    age: { type: Number },
    orientation: { type: String },
    drinkHabit: { type: String },
    smokeHabit: { type: String },
    exercise: { type: String },
    pets: { type: String },
    educationLevel: { type: String },
    zodiac: { type: String },
    height: { type: String, trim: true },
    weight: { type: String, trim: true },
    job: { type: String, trim: true },
    college: { type: String, trim: true },
    interests: [{ type: String }],
    interestedIn: { type: String },
    lookingFor: { type: String },
    ageRangeMin: { type: Number },
    ageRangeMax: { type: Number },
    distanceRange: { type: Number },
    // Permanent Address (Mandatory at registration)
    permanentAddress: {
      country: { type: String, trim: true },
      state: { type: String, trim: true },
      district: { type: String, trim: true },
      city: { type: String, trim: true },
      location: {
        type: {
          type: String,
          enum: ['Point'],
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
        },
      },
    },
    // Temporary / Current GPS Location (Optional)
    currentLocation: {
      location: {
        type: {
          type: String,
          enum: ['Point'],
        },
        coordinates: {
          type: [Number], // [longitude, latitude]
        },
      },
      updatedAt: { type: Date },
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
    },
    languages: [{ type: String }],
    searchPreferences: { type: mongoose.Schema.Types.Mixed, default: {} },
    profileImage: { type: String },
    profileImages: [{ type: String }],
    completionPercentage: { type: Number, default: 0 },
    bio: { type: String, trim: true },
    isLoggedIn: { type: Boolean, default: false },
    lastSeen: { type: Date },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    fcmToken: { type: String, default: null },
  },
  {
    // Explicitly target the collection already created by the user
    collection: 'Registered',
    timestamps: true,
  }
);

UserSchema.pre('save', function () {
  const isInvalidGeo = (loc) => {
    return (
      !loc ||
      !loc.coordinates ||
      !Array.isArray(loc.coordinates) ||
      loc.coordinates.length !== 2 ||
      typeof loc.coordinates[0] !== 'number' ||
      typeof loc.coordinates[1] !== 'number'
    );
  };

  if (this.location && isInvalidGeo(this.location)) {
    this.location = undefined;
  }

  if (this.permanentAddress && this.permanentAddress.location && isInvalidGeo(this.permanentAddress.location)) {
    this.permanentAddress.location = undefined;
  }

  if (this.currentLocation && this.currentLocation.location && isInvalidGeo(this.currentLocation.location)) {
    this.currentLocation = undefined;
  }
});

UserSchema.index({ location: '2dsphere' }, { sparse: true });
UserSchema.index({ 'permanentAddress.location': '2dsphere' }, { sparse: true });
UserSchema.index({ 'currentLocation.location': '2dsphere' }, { sparse: true });

module.exports = mongoose.model('User', UserSchema);
