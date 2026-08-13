const User = require('../models/User');
const Match = require('../models/Match');
const Message = require('../models/Message');
const Block = require('../models/Block');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dwwykeft2',
  api_key: process.env.CLOUDINARY_API_KEY || '888317163598995',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'VYck0A_t17ivmkR6DQApA_FU_Nk',
});

const isBackendVideoUrl = (url) => {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('/video/upload/') ||
    lower.includes('/video/') ||
    lower.includes('video') ||
    /\.(mp4|mov|webm|3gp|mkv|avi|m4v|flv)($|\?|#)/i.test(lower)
  );
};


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
      height,
      weight,
      job,
      college,
      interests,
      interestedIn,
      lookingFor,
      ageRangeMin,
      ageRangeMax,
      distanceRange,
      profileImage,
      profileImages,
      photos: incomingPhotos,
      videos: incomingVideos,
      media: incomingMedia,
      bio,
      gender,
      languages,
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

    // Ensure profileImage and profileImages store valid Cloudinary URLs, Data URIs, or local /uploads/ URLs
    let finalProfileImages = [];
    if (Array.isArray(profileImages) && profileImages.length > 0) {
      finalProfileImages = await Promise.all(
        profileImages.map(async (img) => {
          if (
            typeof img === 'string' &&
            (img.startsWith('http://') || img.startsWith('https://') || img.startsWith('data:image/') || img.startsWith('data:video/'))
          ) {
            return img;
          }
          if (typeof img === 'string' && (img.startsWith('file://') || img.startsWith('content://'))) {
            try {
              const cloudRes = await cloudinary.uploader.unsigned_upload(img, 'Dating_Profiles', { resource_type: 'auto' });
              return cloudRes.secure_url;
            } catch (e) {
              try {
                const cloudRes = await cloudinary.uploader.upload(img, { folder: 'dating_app_profiles', resource_type: 'auto' });
                return cloudRes.secure_url;
              } catch (err2) {
                console.warn('Auto Cloudinary upload error:', err2.message);
                return null;
              }
            }
          }
          return null;
        })
      );
      finalProfileImages = finalProfileImages.filter(Boolean);
    }

    // Combine all valid media URLs (from profileImages, photos, videos, and media sent in body)
    const bodyVideos = Array.isArray(incomingVideos) ? incomingVideos : [];
    const bodyPhotos = Array.isArray(incomingPhotos) ? incomingPhotos : [];
    const bodyMedia = Array.isArray(incomingMedia) ? incomingMedia : [];

    const allMediaUrls = Array.from(
      new Set([
        ...finalProfileImages,
        ...bodyPhotos,
        ...bodyVideos,
        ...bodyMedia
      ].filter((p) => p && typeof p === 'string' && p.startsWith('http')))
    );

    const detectedVideos = allMediaUrls.filter((p) => isBackendVideoUrl(p));

    let finalProfileImage =
      typeof profileImage === 'string' &&
      (profileImage.startsWith('http') || profileImage.startsWith('data:image/') || profileImage.startsWith('data:video/'))
        ? profileImage
        : '';
    if (!finalProfileImage && typeof profileImage === 'string' && (profileImage.startsWith('file://') || profileImage.startsWith('content://'))) {
      try {
        const cloudRes = await cloudinary.uploader.upload(profileImage, { folder: 'dating_app_profiles', resource_type: 'auto' });
        finalProfileImage = cloudRes.secure_url;
      } catch (e) {
        console.warn('Auto Cloudinary upload error for profileImage:', e.message);
      }
    }
    if (!finalProfileImage && allMediaUrls.length > 0) {
      finalProfileImage = allMediaUrls[0];
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
      height,
      weight,
      job,
      college,
      interests,
      interestedIn,
      lookingFor,
      ageRangeMin,
      ageRangeMax,
      distanceRange,
      profileImage: finalProfileImage,
      profileImages: allMediaUrls,
      photos: allMediaUrls,
      videos: detectedVideos,
      media: allMediaUrls,
      bio,
      gender,
      languages,
      completionPercentage
    };

    console.log('--- Save Questionnaire Backend Debug ---');
    console.log('Final saved profileImage:', finalProfileImage);
    console.log('Final saved profileImages count:', allMediaUrls.length, 'URLs:', allMediaUrls);
    console.log('Final saved videos count:', detectedVideos.length, 'URLs:', detectedVideos);
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
        height: updatedUser.height,
        weight: updatedUser.weight,
        job: updatedUser.job,
        college: updatedUser.college,
        interests: updatedUser.interests,
        interestedIn: updatedUser.interestedIn,
        lookingFor: updatedUser.lookingFor,
        ageRangeMin: updatedUser.ageRangeMin,
        ageRangeMax: updatedUser.ageRangeMax,
        distanceRange: updatedUser.distanceRange,
        profileImage: updatedUser.profileImage,
        profileImages: updatedUser.profileImages || [],
        photos: updatedUser.photos || updatedUser.profileImages || [],
        videos: updatedUser.videos || (updatedUser.profileImages || []).filter((p) => isBackendVideoUrl(p)),
        media: updatedUser.media || updatedUser.profileImages || [],
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

function getUserCoordinates(user) {
  if (!user) return null;
  const sources = [
    user.currentLocation?.location?.coordinates,
    user.location?.coordinates,
    user.permanentAddress?.location?.coordinates,
  ];

  for (const coords of sources) {
    if (Array.isArray(coords) && coords.length === 2) {
      const lng = parseFloat(coords[0]);
      const lat = parseFloat(coords[1]);
      if (!isNaN(lng) && !isNaN(lat) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

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
 * Save / Update User GPS Location (Temporary Address / Current Location)
 */
exports.updateLocation = async (req, res) => {
  try {
    let latitude = req.body.latitude ?? req.body.lat ?? req.body.coords?.latitude;
    let longitude = req.body.longitude ?? req.body.lng ?? req.body.coords?.longitude;

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
          currentLocation: {
            location: {
              type: 'Point',
              coordinates: [lng, lat],
            },
            updatedAt: new Date(),
          },
          location: {
            type: 'Point',
            coordinates: [lng, lat],
          },
        },
      },
      { new: true }
    );

    console.log(`[DATABASE UPDATE] Temporary Current Location saved for user ${req.user._id} (${updatedUser?.name || 'User'}): [lng: ${lng}, lat: ${lat}]`);

    return res.status(200).json({
      message: 'Temporary current location updated successfully',
      currentLocation: updatedUser?.currentLocation,
    });
  } catch (error) {
    console.error('Update location error:', error);
    return res.status(500).json({ message: 'Server error while updating location.' });
  }
};

/**
 * Clear User Current GPS Location (Reverts filtering back to permanent address)
 */
exports.clearCurrentLocation = async (req, res) => {
  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $unset: { currentLocation: 1 },
      },
      { new: true }
    );

    console.log(`[DATABASE UPDATE] Cleared current location for user ${req.user._id}. Reverted to permanent address.`);

    return res.status(200).json({
      message: 'Current location cleared successfully. Filtering will now use Permanent Address.',
      permanentAddress: updatedUser?.permanentAddress,
    });
  } catch (error) {
    console.error('Clear location error:', error);
    return res.status(500).json({ message: 'Server error while clearing current location.' });
  }
};

/**
 * Get questionnaire details of all other users filtered by distance range using MongoDB $geoNear
 * Prioritizes: 1. Current Location (if present) -> 2. Permanent Address
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

    // Prioritize Current Location over Permanent Address for filtering
    const hasCurrentLocation =
      currentUser?.currentLocation?.location?.coordinates?.length === 2 &&
      typeof currentUser.currentLocation.location.coordinates[0] === 'number' &&
      typeof currentUser.currentLocation.location.coordinates[1] === 'number';

    const hasPermanentLocation =
      currentUser?.permanentAddress?.location?.coordinates?.length === 2 &&
      typeof currentUser.permanentAddress.location.coordinates[0] === 'number' &&
      typeof currentUser.permanentAddress.location.coordinates[1] === 'number';

    const hasLegacyLocation =
      currentUser?.location?.coordinates?.length === 2 &&
      typeof currentUser.location.coordinates[0] === 'number' &&
      typeof currentUser.location.coordinates[1] === 'number';

    let activeUserCoordinates = null;
    let locationSource = 'None';

    if (hasCurrentLocation) {
      activeUserCoordinates = currentUser.currentLocation.location.coordinates;
      locationSource = 'Current Location (Temporary)';
    } else if (hasPermanentLocation) {
      activeUserCoordinates = currentUser.permanentAddress.location.coordinates;
      locationSource = 'Permanent Address';
    } else if (hasLegacyLocation) {
      activeUserCoordinates = currentUser.location.coordinates;
      locationSource = 'Legacy Location';
    }

    console.log(`📍 [SUGGESTION FEED FILTER] User ${currentUser?._id} filtering profiles using: ${locationSource} ->`, activeUserCoordinates);

    const hasUserLocation = activeUserCoordinates !== null;

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
      const userLng = activeUserCoordinates[0];
      const userLat = activeUserCoordinates[1];

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
        const userLng = activeUserCoordinates[0];
        const userLat = activeUserCoordinates[1];

        users = users.filter((u) => {
          // Candidate active coordinates: Current Location -> Permanent Address -> Legacy Location
          const candidateCoords =
            u.currentLocation?.location?.coordinates ||
            u.permanentAddress?.location?.coordinates ||
            u.location?.coordinates;

          if (Array.isArray(candidateCoords) && candidateCoords.length === 2) {
            const distKm = calculateHaversineDistance(
              userLat,
              userLng,
              candidateCoords[1],
              candidateCoords[0]
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
          const formatted = (Math.round(kmVal * 10) / 10).toString();
          distanceText = `${formatted} km away`;
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
          const formatted = (Math.round(kmVal * 10) / 10).toString();
          distanceText = `${formatted} km away`;
        }

        return {
          id: u._id ? u._id.toString() : u.id,
          name: u.firstName || u.name,
          email: u.email,
          bdayDay: u.bdayDay,
          bdayMonth: u.bdayMonth,
          bdayYear: u.bdayYear,
          age: u.computedCandidateAge || u.age || null,
          distance: distanceText,
          bio: u.bio || '',
          interests: u.interests || [],
          commonInterests: u.commonInterests || [],
          commonInterestsCount: u.commonInterestsCount || 0,
          matchPercentage: u.matchPercentage || 0,
          image: u.profileImage || '',
          profileImages: u.profileImages || [],
          photos: u.photos || u.profileImages || [],
          videos: u.videos || (u.profileImages || []).filter((p) => isBackendVideoUrl(p)),
          media: u.media || u.profileImages || [],
          gender: u.gender,
          orientation: u.orientation || '',
          lookingFor: u.lookingFor || '',
          drinkHabit: u.drinkHabit || '',
          smokeHabit: u.smokeHabit || '',
          exercise: u.exercise || '',
          pets: u.pets || '',
          educationLevel: u.educationLevel || '',
          zodiac: u.zodiac || '',
          height: u.height || '',
          weight: u.weight || '',
          job: u.job || '',
          college: u.college || '',
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
 * Get user profile by ID
 */
exports.getProfile = async (req, res) => {
  try {
    const freshUser = await User.findById(req.user._id).select('-password');
    if (!freshUser) {
      return res.status(404).json({ message: 'User not found.' });
    }

    return res.status(200).json({
      message: 'Profile fetched successfully',
      user: {
        id: freshUser._id,
        _id: freshUser._id,
        name: freshUser.name,
        email: freshUser.email,
        mobile: freshUser.mobile,
        gender: freshUser.gender,
        firstName: freshUser.firstName,
        bdayDay: freshUser.bdayDay,
        bdayMonth: freshUser.bdayMonth,
        bdayYear: freshUser.bdayYear,
        age: freshUser.age,
        orientation: freshUser.orientation,
        drinkHabit: freshUser.drinkHabit,
        smokeHabit: freshUser.smokeHabit,
        exercise: freshUser.exercise,
        pets: freshUser.pets,
        educationLevel: freshUser.educationLevel,
        zodiac: freshUser.zodiac,
        height: freshUser.height,
        weight: freshUser.weight,
        job: freshUser.job,
        college: freshUser.college,
        interests: freshUser.interests || [],
        languages: freshUser.languages || [],
        interestedIn: freshUser.interestedIn,
        lookingFor: freshUser.lookingFor,
        ageRangeMin: freshUser.ageRangeMin,
        ageRangeMax: freshUser.ageRangeMax,
        distanceRange: freshUser.distanceRange,
        profileImage: freshUser.profileImage,
        profileImages: freshUser.profileImages || [],
        photos: freshUser.photos || freshUser.profileImages || [],
        videos: freshUser.videos || (freshUser.profileImages || []).filter((p) => isBackendVideoUrl(p)),
        media: freshUser.media || freshUser.profileImages || [],
        completionPercentage: freshUser.completionPercentage || 0,
        bio: freshUser.bio || '',
        permanentAddress: freshUser.permanentAddress,
        currentLocation: freshUser.currentLocation,
        location: freshUser.location,
        isLoggedIn: freshUser.isLoggedIn,
        fcmToken: freshUser.fcmToken,
      }
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    return res.status(500).json({ message: 'Server error while fetching profile.', error: error.message });
  }
};

/**
 * Get other logged-in users (online users)
 */
exports.getOnlineUsers = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    const currentUserCoords = getUserCoordinates(currentUser);

    const users = await User.find({
      _id: { $ne: req.user._id },
      isLoggedIn: true
    });
    
    return res.status(200).json({
      message: 'Online users fetched successfully',
      users: users.map(u => {
        const targetUserCoords = getUserCoordinates(u);
        let distanceText = '1 km away';
        if (currentUserCoords && targetUserCoords) {
          const kmVal = calculateHaversineDistance(
            currentUserCoords.lat,
            currentUserCoords.lng,
            targetUserCoords.lat,
            targetUserCoords.lng
          );
          const formatted = (Math.round(kmVal * 10) / 10).toString();
          distanceText = `${formatted} km away`;
        } else if (u.distanceRange) {
          distanceText = `${u.distanceRange} km away`;
        }

        return {
          id: u._id.toString(),
          name: u.firstName || u.name,
          age: u.age || 22,
          distance: distanceText,
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
          height: u.height,
          weight: u.weight,
          job: u.job,
          college: u.college,
        };
      })
    });
  } catch (error) {
    console.error('Fetch online users error:', error);
    return res.status(500).json({ message: 'Server error while fetching online users.' });
  }
};

/**
 * Upload profile photo to Cloudinary
 */
exports.uploadImage = async (req, res) => {
  try {
    const file = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    const bodyImage = req.body?.photo || req.body?.image || req.body?.file || req.body?.base64;

    let imageUrl = null;

    // Helper to upload photos & videos to Cloudinary using Dating_Profiles preset
    const doCloudinaryUpload = async (inputData, mimetype = 'image/jpeg') => {
      const isVideo = mimetype && mimetype.startsWith('video/');
      const uploadOptions = {
        folder: 'dating_app_profiles',
        resource_type: 'auto', // Auto-detect image, video, or audio
      };

      try {
        console.log(`Attempting Cloudinary unsigned_upload for ${isVideo ? 'video' : 'photo'}...`);
        const cloudRes = await cloudinary.uploader.unsigned_upload(inputData, 'Dating_Profiles', { resource_type: 'auto' });
        if (cloudRes && cloudRes.secure_url) {
          return cloudRes.secure_url;
        }
      } catch (err1) {
        console.warn('Cloudinary unsigned_upload failed, trying signed upload:', err1.message || err1);
        try {
          const cloudRes = await cloudinary.uploader.upload(inputData, uploadOptions);
          if (cloudRes && cloudRes.secure_url) {
            return cloudRes.secure_url;
          }
        } catch (err2) {
          console.warn('Cloudinary signed upload failed:', err2.message || err2);
        }
      }
      return null;
    };

    const fileMime = file?.mimetype || 'image/jpeg';

    if (file && file.path) {
      imageUrl = await doCloudinaryUpload(file.path, fileMime);
      if (!imageUrl) {
        // Fallback: Serve file locally from /uploads directory if Cloudinary upload is unavailable
        const filename = path.basename(file.path);
        const protocol = req.protocol || 'http';
        const host = req.get('host') || 'localhost:5000';
        imageUrl = `${protocol}://${host}/uploads/${filename}`;
        console.log('[uploadImage] Using local /uploads/ fallback URL:', imageUrl);
      } else {
        // Clean up temp file after Cloudinary upload
        if (fs.existsSync(file.path)) {
          try {
            fs.unlinkSync(file.path);
          } catch (e) {}
        }
      }
    } else if (file && file.buffer) {
      const base64Str = `data:${fileMime};base64,${file.buffer.toString('base64')}`;
      imageUrl = await doCloudinaryUpload(base64Str, fileMime);
    } else if (bodyImage && typeof bodyImage === 'string' && bodyImage.length > 20) {
      imageUrl = await doCloudinaryUpload(bodyImage, fileMime);
    }

    if (!imageUrl || !imageUrl.startsWith('http')) {
      return res.status(400).json({ message: 'Cloudinary upload failed. Please check your connection and Cloudinary credentials.' });
    }

    console.log('Final Cloudinary Upload URL:', imageUrl);

    return res.status(200).json({
      message: 'File uploaded to Cloudinary successfully',
      url: imageUrl,
      secure_url: imageUrl,
      mediaType: fileMime.startsWith('video/') ? 'video' : 'image',
    });
  } catch (error) {
    console.error('File upload handler error:', error);
    return res.status(500).json({ message: 'Server error during file upload.', error: error.message || String(error) });
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
    user.height = undefined;
    user.weight = undefined;
    user.job = undefined;
    user.college = undefined;
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

/**
 * Update FCM Token for Push Notifications
 */
exports.updateFcmToken = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: 'FCM Token is required.' });
    }

    await User.findByIdAndUpdate(req.user._id, { fcmToken });
    console.log(`[FCM Token] Updated FCM token for user ${req.user._id}`);
    return res.status(200).json({ message: 'FCM Token updated successfully.' });
  } catch (error) {
    console.error('Update FCM Token error:', error);
    return res.status(500).json({ message: 'Server error while updating FCM Token.' });
  }
};

/**
 * GET /api/profile/questionnaire-options
 */
exports.getQuestionnaireOptions = async (req, res) => {
  try {
    const { QUESTIONNAIRE_OPTIONS } = require('./questionnaireController');
    return res.status(200).json({
      success: true,
      message: 'Questionnaire questions and options retrieved successfully',
      options: QUESTIONNAIRE_OPTIONS,
    });
  } catch (error) {
    console.error('Error fetching questionnaire options:', error);
    return res.status(500).json({
      success: false,
      message: 'Server error while retrieving questionnaire options',
    });
  }
};

