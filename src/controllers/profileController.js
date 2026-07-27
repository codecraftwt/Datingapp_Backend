const User = require('../models/User');
const Match = require('../models/Match');
const Message = require('../models/Message');
const Block = require('../models/Block');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Save/Update user dating profile questionnaire
 */
exports.saveQuestionnaire = async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      firstName,
      bdayDay,
      bdayMonth,
      bdayYear,
      age,
      orientation,
      drinkHabit,
      smokeHabit,
      exercise,
      pets,
      educationLevel,
      zodiac,
      interests,
      interestedIn,
      lookingFor,
      ageRangeMin,
      ageRangeMax,
      distanceRange,
      profileImage,
      profileImages,
      bio,
      gender,
      completionPercentage
    } = req.body;

    let computedAge = parseInt(age, 10);
    if (bdayYear && bdayMonth && bdayDay) {
      const year = parseInt(bdayYear, 10);
      const month = parseInt(bdayMonth, 10);
      const day = parseInt(bdayDay, 10);
      if (year > 1900) {
        const today = new Date();
        let calc = today.getFullYear() - year;
        const monthDiff = (today.getMonth() + 1) - month;
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
          calc--;
        }
        if (calc >= 18 && calc <= 120) {
          computedAge = calc;
        }
      }
    }

    const setObj = {
      firstName,
      bdayDay,
      bdayMonth,
      bdayYear,
      age: computedAge || age || 24,
      orientation,
      drinkHabit,
      smokeHabit,
      exercise,
      pets,
      educationLevel,
      zodiac,
      interests,
      interestedIn,
      lookingFor,
      ageRangeMin,
      ageRangeMax,
      distanceRange,
      profileImage,
      profileImages,
      bio,
      gender,
      completionPercentage
    };

    console.log('--- Save Questionnaire Backend Debug ---');
    console.log('Incoming latitude:', latitude, 'longitude:', longitude);

    if (latitude !== undefined && longitude !== undefined) {
      const lat = parseFloat(latitude);
      const lng = parseFloat(longitude);
      if (!isNaN(lat) && !isNaN(lng)) {
        setObj.location = {
          type: 'Point',
          coordinates: [lng, lat]
        };
        console.log(`[SAVE QUESTIONNAIRE SUCCESS] Location set for ${req.user._id}: [${lng}, ${lat}]`);
      } else {
        console.log('[SAVE QUESTIONNAIRE WARNING] Invalid lat/lng floats:', lat, lng);
      }
    } else {
      console.log('[SAVE QUESTIONNAIRE WARNING] Latitude and Longitude NOT provided in request body');
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: setObj },
      { new: true, runValidators: true }
    );

    return res.status(200).json({
      message: 'Questionnaire saved successfully',
      user: {
        id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        mobile: updatedUser.mobile,
        gender: updatedUser.gender,
        firstName: updatedUser.firstName,
        bdayDay: updatedUser.bdayDay,
        bdayMonth: updatedUser.bdayMonth,
        bdayYear: updatedUser.bdayYear,
        age: updatedUser.age,
        orientation: updatedUser.orientation,
        drinkHabit: updatedUser.drinkHabit,
        smokeHabit: updatedUser.smokeHabit,
        exercise: updatedUser.exercise,
        pets: updatedUser.pets,
        educationLevel: updatedUser.educationLevel,
        zodiac: updatedUser.zodiac,
        interests: updatedUser.interests,
        interestedIn: updatedUser.interestedIn,
        lookingFor: updatedUser.lookingFor,
        ageRangeMin: updatedUser.ageRangeMin,
        ageRangeMax: updatedUser.ageRangeMax,
        distanceRange: updatedUser.distanceRange,
        profileImage: updatedUser.profileImage,
        profileImages: updatedUser.profileImages || [],
        completionPercentage: updatedUser.completionPercentage || 0,
        bio: updatedUser.bio || '',
        location: updatedUser.location
      }
    });
  } catch (error) {
    console.error('Save questionnaire error:', error);
    return res.status(500).json({ message: 'Server error while saving questionnaire.' });
  }
};

/**
 * Helper function to calculate Haversine distance in km
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of Earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Save / Update User GPS Location
 */
exports.updateLocation = async (req, res) => {
  try {
    let latitude = req.body.latitude ?? req.body.lat ?? req.body.coords?.latitude;
    let longitude = req.body.longitude ?? req.body.lng ?? req.body.coords?.longitude;

    if (latitude === undefined || longitude === undefined) {
      console.log('ℹ️ [BACKEND LOCATION] Latitude/Longitude missing in body. Attempting IP fallback...');
      try {
        const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        const ipRes = await fetch(`http://ip-api.com/json/${clientIp}`);
        if (ipRes.ok) {
          const ipData = await ipRes.json();
          if (ipData && ipData.status === 'success' && typeof ipData.lat === 'number' && typeof ipData.lon === 'number') {
            latitude = ipData.lat;
            longitude = ipData.lon;
            console.log(`✅ [BACKEND IP GEO] Resolved IP ${clientIp} to [lat: ${latitude}, lng: ${longitude}]`);
          }
        }
      } catch (ipErr) {
        console.log('⚠️ [BACKEND IP GEO ERROR]', ipErr.message || ipErr);
      }
    }

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: 'Latitude and longitude are required.' });
    }

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ message: 'Invalid latitude or longitude values.' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          location: {
            type: 'Point',
            coordinates: [lng, lat],
          },
        },
      },
      { new: true }
    );

    console.log(`[DATABASE UPDATE] Location saved for user ${req.user._id} (${updatedUser?.name || 'User'}): [lng: ${lng}, lat: ${lat}]`);

    return res.status(200).json({
      message: 'Location updated successfully',
      location: updatedUser?.location,
    });
  } catch (error) {
    console.error('Update location error:', error);
    return res.status(500).json({ message: 'Server error while updating location.' });
  }
};

/**
 * Get questionnaire details of all other users filtered by distance range using MongoDB $geoNear
 */
exports.getQuestionnaires = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);

    const blocks = await Block.find({
      $or: [{ blockerId: req.user._id }, { blockedId: req.user._id }]
    });
    const blockedIds = blocks.map(b => b.blockerId.toString() === req.user._id.toString() ? b.blockedId : b.blockerId);

    const userDistanceRangeKm = currentUser?.distanceRange || 50;
    const maxDistanceMeters = userDistanceRangeKm * 1000;

    const userInterestedIn = (currentUser?.interestedIn || 'Everyone').trim();
    const minAge = parseInt(currentUser?.ageRangeMin, 10) || 18;
    const maxAge = parseInt(currentUser?.ageRangeMax, 10) || 100;
    const userInterests = currentUser?.interests || [];

    const hasUserLocation =
      currentUser &&
      currentUser.location &&
      Array.isArray(currentUser.location.coordinates) &&
      currentUser.location.coordinates.length === 2 &&
      typeof currentUser.location.coordinates[0] === 'number' &&
      typeof currentUser.location.coordinates[1] === 'number';

    // Build Mongo Query Object based on Gender Preference
    const mongoQuery = {
      _id: { $ne: req.user._id, $nin: blockedIds },
      firstName: { $exists: true, $ne: null }
    };

    if (userInterestedIn === 'Women' || userInterestedIn === 'Female') {
      mongoQuery.gender = { $in: ['Women', 'Female', 'Woman'] };
    } else if (userInterestedIn === 'Male' || userInterestedIn === 'Men') {
      mongoQuery.gender = { $in: ['Male', 'Man', 'Men'] };
    }

    let users = [];

    if (hasUserLocation) {
      const userLng = currentUser.location.coordinates[0];
      const userLat = currentUser.location.coordinates[1];

      try {
        users = await User.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [userLng, userLat] },
              distanceField: 'calculatedDistanceMeters',
              maxDistance: maxDistanceMeters,
              spherical: true,
              query: mongoQuery
            }
          }
        ]);
      } catch (geoErr) {
        console.error('MongoDB $geoNear error, falling back to standard find:', geoErr.message);
        users = [];
      }
    }

    // Fallback if $geoNear query produced no results or user has no location saved yet
    if (users.length === 0) {
      users = await User.find(mongoQuery).lean();

      // Filter by Haversine distance if user has location
      if (hasUserLocation) {
        const userLng = currentUser.location.coordinates[0];
        const userLat = currentUser.location.coordinates[1];

        users = users.filter((u) => {
          if (
            u.location &&
            Array.isArray(u.location.coordinates) &&
            u.location.coordinates.length === 2
          ) {
            const distKm = calculateHaversineDistance(
              userLat,
              userLng,
              u.location.coordinates[1],
              u.location.coordinates[0]
            );
            u.calculatedDistanceMeters = distKm * 1000;
            return distKm <= userDistanceRangeKm;
          }
          return true;
        });
      }
    }

    // Filter candidate users by Age Preference Range (minAge to maxAge)
    users = users.filter((u) => {
      let candidateAge = parseInt(u.age, 10);
      if (u.bdayYear && u.bdayMonth && u.bdayDay) {
        const year = parseInt(u.bdayYear, 10);
        const month = parseInt(u.bdayMonth, 10);
        const day = parseInt(u.bdayDay, 10);
        if (year > 1900) {
          const today = new Date();
          let calc = today.getFullYear() - year;
          const monthDiff = (today.getMonth() + 1) - month;
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
            calc--;
          }
          if (calc >= 18 && calc <= 120) {
            candidateAge = calc;
          }
        }
      }
      u.computedCandidateAge = candidateAge;
      if (candidateAge) {
        return candidateAge >= minAge && candidateAge <= maxAge;
      }
      return true;
    });

    // Compute Common Interests & Match Percentage for each candidate
    users = users.map((u) => {
      const candidateInterests = u.interests || [];
      const common = candidateInterests.filter((i) => userInterests.includes(i));
      const matchPercentage = userInterests.length > 0 ? Math.round((common.length / userInterests.length) * 100) : 0;
      return {
        ...u,
        commonInterests: common,
        commonInterestsCount: common.length,
        matchPercentage: matchPercentage,
      };
    });

    // Smart Ranking: Sort candidate profiles so higher common interest overlap appears first
    users.sort((a, b) => (b.commonInterestsCount || 0) - (a.commonInterestsCount || 0));

    console.log('--- Fetch Questionnaires Backend Debug ---');
    console.log('Logged-in User ID:', req.user._id.toString());
    console.log('Interested In:', userInterestedIn);
    console.log('Age Range:', minAge, '-', maxAge);
    console.log('Distance Range (km):', userDistanceRangeKm);
    console.log('Found candidates count:', users.length);

    const userLat = hasUserLocation ? currentUser.location.coordinates[1] : null;
    const userLng = hasUserLocation ? currentUser.location.coordinates[0] : null;

    return res.status(200).json({
      message: 'Questionnaires fetched successfully',
      users: users.map(u => {
        let distanceText = '1 km away';

        if (typeof u.calculatedDistanceMeters === 'number') {
          const kmVal = u.calculatedDistanceMeters / 1000;
          if (kmVal < 0.5) {
            distanceText = 'Less than 1 km away';
          } else {
            const formatted = (Math.round(kmVal * 10) / 10).toString();
            distanceText = `${formatted} km away`;
          }
        } else if (
          userLat !== null &&
          userLng !== null &&
          u.location &&
          Array.isArray(u.location.coordinates) &&
          u.location.coordinates.length === 2
        ) {
          const kmVal = calculateHaversineDistance(
            userLat,
            userLng,
            u.location.coordinates[1],
            u.location.coordinates[0]
          );
          if (kmVal < 0.5) {
            distanceText = 'Less than 1 km away';
          } else {
            const formatted = (Math.round(kmVal * 10) / 10).toString();
            distanceText = `${formatted} km away`;
          }
        } else if (u.distanceRange) {
          distanceText = `${u.distanceRange} km away`;
        }

        return {
          id: u._id ? u._id.toString() : u.id,
          name: u.firstName || u.name,
          email: u.email,
          bdayDay: u.bdayDay,
          bdayMonth: u.bdayMonth,
          bdayYear: u.bdayYear,
          age: u.computedCandidateAge || u.age || 22,
          distance: distanceText,
          bio: u.bio || '',
          interests: u.interests && u.interests.length > 0 ? u.interests : ['☕ Coffee lover'],
          commonInterests: u.commonInterests || [],
          commonInterestsCount: u.commonInterestsCount || 0,
          matchPercentage: u.matchPercentage || 0,
          image: u.profileImage || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=600',
          gender: u.gender,
          orientation: u.orientation || 'Straight',
          lookingFor: u.lookingFor || 'Long-term partner',
          drinkHabit: u.drinkHabit || 'Social drinker',
          smokeHabit: u.smokeHabit || 'Never',
          exercise: u.exercise || 'Occasionally',
          pets: u.pets || 'Dog',
          educationLevel: u.educationLevel || 'Undergraduate Degree',
          zodiac: u.zodiac || 'Gemini',
          isOnline: (u.isLoggedIn === true) && (global.onlineUsers ? global.onlineUsers.has((u._id || u.id).toString()) : false),
          lastSeen: u.lastSeen || u.updatedAt || u.createdAt,
        };
      })
    });
  } catch (error) {
    console.error('Fetch questionnaires error:', error);
    return res.status(500).json({ message: 'Server error while fetching questionnaires.' });
  }
};

/**
 * Get current user profile questionnaire details
 */
exports.getProfile = async (req, res) => {
  try {
    return res.status(200).json({
      message: 'Profile fetched successfully',
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        mobile: req.user.mobile,
        gender: req.user.gender,
        firstName: req.user.firstName,
        bdayDay: req.user.bdayDay,
        bdayMonth: req.user.bdayMonth,
        bdayYear: req.user.bdayYear,
        age: req.user.age,
        orientation: req.user.orientation,
        drinkHabit: req.user.drinkHabit,
        smokeHabit: req.user.smokeHabit,
        exercise: req.user.exercise,
        pets: req.user.pets,
        educationLevel: req.user.educationLevel,
        zodiac: req.user.zodiac,
        interests: req.user.interests,
        interestedIn: req.user.interestedIn,
        lookingFor: req.user.lookingFor,
        ageRangeMin: req.user.ageRangeMin,
        ageRangeMax: req.user.ageRangeMax,
        distanceRange: req.user.distanceRange,
        profileImage: req.user.profileImage,
        profileImages: req.user.profileImages || [],
        completionPercentage: req.user.completionPercentage || 0,
        bio: req.user.bio || ''
      }
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    return res.status(500).json({ message: 'Server error while fetching profile.' });
  }
};

/**
 * Get other logged-in users (online users)
 */
exports.getOnlineUsers = async (req, res) => {
  try {
    const users = await User.find({
      _id: { $ne: req.user._id },
      isLoggedIn: true
    });
    
    return res.status(200).json({
      message: 'Online users fetched successfully',
      users: users.map(u => ({
        id: u._id.toString(),
        name: u.firstName || u.name,
        age: u.age || 22,
        distance: u.distanceRange ? `${u.distanceRange} miles away` : '3 miles away',
        bio: u.bio || '',
        interests: u.interests && u.interests.length > 0 ? u.interests : ['☕ Coffee lover'],
        image: u.profileImage || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&q=80&w=600',
        gender: u.gender,
        orientation: u.orientation || 'Straight',
        lookingFor: u.lookingFor || 'Long-term partner',
        drinkHabit: u.drinkHabit || 'Social drinker',
        smokeHabit: u.smokeHabit || 'Never',
        exercise: u.exercise || 'Occasionally',
        pets: u.pets || 'Dog',
        educationLevel: u.educationLevel || 'Undergraduate Degree',
        zodiac: u.zodiac || 'Gemini',
      }))
    });
  } catch (error) {
    console.error('Fetch online users error:', error);
    return res.status(500).json({ message: 'Server error while fetching online users.' });
  }
};

/**
 * Upload profile photo
 */
exports.uploadImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded.' });
    }

    // Upload to Cloudinary using Unsigned Preset
    const result = await cloudinary.uploader.unsigned_upload(req.file.path, 'Dating_Profiles', {
      folder: 'dating_app_profiles',
    });

    // Delete temporary file from backend server local storage
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    return res.status(200).json({
      message: 'File uploaded successfully to Cloudinary',
      url: result.secure_url,
    });
  } catch (error) {
    console.error('File upload error:', error);
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (err) {
        console.error('Failed to clean up temporary file after error:', err);
      }
    }
    return res.status(500).json({ message: 'Server error during file upload.' });
  }
};

/**
 * Remove a profile image from database and Cloudinary
 */
exports.removeProfilePhoto = async (req, res) => {
  try {
    const { imageUrl, index } = req.body;
    const currentUserId = req.user._id;

    if (!imageUrl) {
      return res.status(400).json({ message: 'Image URL is required.' });
    }

    const user = await User.findById(currentUserId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    let updatedImages = user.profileImages ? [...user.profileImages] : [];
    if (typeof index === 'number' && index >= 0 && index < 9) {
      updatedImages[index] = null;
    } else {
      updatedImages = updatedImages.map(img => img === imageUrl ? null : img);
    }
    user.profileImages = updatedImages;

    if (user.profileImage === imageUrl) {
      const nextImage = updatedImages.find(img => img !== null) || null;
      user.profileImage = nextImage;
    }

    try {
      const match = imageUrl.match(/dating_app_profiles\/[^.]+/);
      if (match) {
        const publicId = match[0];
        console.log('Destroying Cloudinary asset with publicId:', publicId);
        await cloudinary.uploader.destroy(publicId);
      }
    } catch (cloudinaryError) {
      console.error('Failed to destroy Cloudinary image:', cloudinaryError);
    }

    await user.save();

    return res.status(200).json({
      message: 'Photo removed successfully.',
      user: {
        id: user._id,
        profileImage: user.profileImage,
        profileImages: user.profileImages,
      }
    });
  } catch (error) {
    console.error('Remove photo error:', error);
    return res.status(500).json({ message: 'Server error while removing photo.' });
  }
};

/**
 * Remove profile questionnaire answers and details (keeps account credentials)
 */
exports.removeProfile = async (req, res) => {
  try {
    const currentUserId = req.user._id;

    await Match.deleteMany({
      $or: [
        { likerId: currentUserId },
        { likedId: currentUserId }
      ]
    });

    await Message.deleteMany({
      $or: [
        { senderId: currentUserId },
        { receiverId: currentUserId }
      ]
    });

    const user = await User.findById(currentUserId);
    if (!user) {
      return res.status(404).json({ message: 'User not found.' });
    }

    user.firstName = undefined;
    user.bdayDay = undefined;
    user.bdayMonth = undefined;
    user.bdayYear = undefined;
    user.age = undefined;
    user.orientation = undefined;
    user.drinkHabit = undefined;
    user.smokeHabit = undefined;
    user.exercise = undefined;
    user.pets = undefined;
    user.educationLevel = undefined;
    user.zodiac = undefined;
    user.interests = [];
    user.interestedIn = undefined;
    user.lookingFor = undefined;
    user.ageRangeMin = undefined;
    user.ageRangeMax = undefined;
    user.distanceRange = undefined;
    user.profileImage = undefined;
    user.profileImages = [];
    user.completionPercentage = 0;
    user.bio = "";

    await user.save();

    return res.status(200).json({
      message: 'Profile details removed successfully.',
      user
    });
  } catch (error) {
    console.error('Remove profile error:', error);
    return res.status(500).json({ message: 'Server error while removing profile.' });
  }
};
