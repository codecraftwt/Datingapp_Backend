const mongoose = require('mongoose');
const User = require('../models/User');
const Match = require('../models/Match');
const Message = require('../models/Message');
const Block = require('../models/Block');
const Report = require('../models/Report');
const fs = require('fs');
const path = require('path');
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

const checkIsOnline = (user) => {
  if (!user) return false;
  const uIdStr = (user._id || user.id || user).toString();
  if (global.onlineUsers && global.onlineUsers.has(uIdStr)) return true;
  if (global.io && global.io.sockets && global.io.sockets.adapter && global.io.sockets.adapter.rooms.has(uIdStr)) {
    const rm = global.io.sockets.adapter.rooms.get(uIdStr);
    if (rm && rm.size > 0) return true;
  }
  if (user.isOnline === true) return true;
  if (user.isLoggedIn === true && user.lastSeen && (Date.now() - new Date(user.lastSeen).getTime() < 300000)) return true;
  return false;
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
    let activeMediaList = [];
    if (Array.isArray(profileImages) && profileImages.length > 0) {
      activeMediaList = profileImages;
    } else if (Array.isArray(incomingPhotos) && incomingPhotos.length > 0) {
      activeMediaList = incomingPhotos;
    } else if (Array.isArray(incomingMedia) && incomingMedia.length > 0) {
      activeMediaList = incomingMedia;
    }

    let finalProfileImages = [];
    if (activeMediaList.length > 0) {
      finalProfileImages = await Promise.all(
        activeMediaList.map(async (img) => {
          if (!img || typeof img !== 'string' || img === 'null' || img === 'undefined') return null;
          if (
            img.startsWith('http://') ||
            img.startsWith('https://') ||
            img.startsWith('data:image/') ||
            img.startsWith('data:video/')
          ) {
            return img;
          }
          if (img.startsWith('file://') || img.startsWith('content://')) {
            try {
              const isVid = isBackendVideoUrl(img);
              const cloudRes = await cloudinary.uploader.upload(img, { folder: 'dating_app_profiles', resource_type: isVid ? 'video' : 'auto' });
              return cloudRes.secure_url;
            } catch (err) {
              console.warn('Auto Cloudinary upload error:', err.message);
              return null;
            }
          }
          return null;
        })
      );
      finalProfileImages = finalProfileImages.filter(Boolean);
    }

    const detectedVideos = finalProfileImages.filter((p) => isBackendVideoUrl(p));
    const detectedPhotos = finalProfileImages.filter((p) => !isBackendVideoUrl(p));

    let finalProfileImage =
      typeof profileImage === 'string' &&
      (profileImage.startsWith('http') || profileImage.startsWith('data:image/') || profileImage.startsWith('data:video/'))
        ? profileImage
        : (finalProfileImages[0] || null);

    if (!finalProfileImage && typeof profileImage === 'string' && (profileImage.startsWith('file://') || profileImage.startsWith('content://'))) {
      try {
        const cloudRes = await cloudinary.uploader.upload(profileImage, { folder: 'dating_app_profiles', resource_type: 'auto' });
        finalProfileImage = cloudRes.secure_url;
      } catch (e) {
        console.warn('Auto Cloudinary upload error for profileImage:', e.message);
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
      profileImages: finalProfileImages,
      photos: detectedPhotos.length > 0 ? detectedPhotos : finalProfileImages,
      videos: detectedVideos,
      media: finalProfileImages,
      bio,
      gender,
      languages,
      completionPercentage
    };

    console.log('--- Save Questionnaire Backend Debug ---');
    console.log('Final saved profileImage:', finalProfileImage);
    console.log('Final saved profileImages count:', finalProfileImages.length, 'URLs:', finalProfileImages);
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
      firstName: { $exists: true, $ne: null },
      isProfileHidden: { $ne: true }
    };

    if (userInterestedIn === 'Women' || userInterestedIn === 'Female') {
      mongoQuery.gender = { $in: ['Women', 'Female', 'Woman'] };
    } else if (userInterestedIn === 'Male' || userInterestedIn === 'Men') {
      mongoQuery.gender = { $in: ['Male', 'Man', 'Men'] };
    }

    let users = [];

    let geoKey = 'location';
    if (hasCurrentLocation) {
      geoKey = 'currentLocation.location';
    } else if (hasPermanentLocation) {
      geoKey = 'permanentAddress.location';
    }

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
              key: geoKey,
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

        const hiddenSet = new Set(Array.isArray(u.hiddenMedia) ? u.hiddenMedia : []);

        const rawProfileImages = (Array.isArray(u.profileImages) ? u.profileImages : [])
          .filter((p) => p && typeof p === 'string' && p.trim().length > 0 && p !== 'null' && p !== 'undefined');

        const activeMediaSet = new Set(
          rawProfileImages.length > 0
            ? rawProfileImages
            : (u.profileImage && u.profileImage !== 'null' ? [u.profileImage] : [])
        );

        const publicProfileImages = Array.from(activeMediaSet).filter((p) => !hiddenSet.has(p));
        const publicPhotos = publicProfileImages.filter((p) => !isBackendVideoUrl(p));
        const publicVideos = publicProfileImages.filter((p) => isBackendVideoUrl(p));
        const publicMedia = publicProfileImages;

        const safeProfileImage = (u.profileImage && activeMediaSet.has(u.profileImage) && !hiddenSet.has(u.profileImage))
          ? u.profileImage
          : (publicProfileImages[0] || '');

        return {
          id: u._id,
          _id: u._id,
          name: u.firstName || u.name,
          firstName: u.firstName,
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
          image: safeProfileImage,
          profileImage: safeProfileImage,
          profileImages: publicProfileImages,
          photos: publicPhotos,
          videos: publicVideos,
          media: publicMedia,
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
          isOnline: checkIsOnline(u),
          isVerified: !!u.isEmailVerified,
          isEmailVerified: !!u.isEmailVerified,
          isMobileVerified: !!u.isMobileVerified,
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
        hiddenMedia: freshUser.hiddenMedia || [],
        completionPercentage: freshUser.completionPercentage || 0,
        bio: freshUser.bio || '',
        permanentAddress: freshUser.permanentAddress,
        currentLocation: freshUser.currentLocation,
        isOnline: true,
        isLoggedIn: true,
        isProfileHidden: !!freshUser.isProfileHidden,
        isVerified: !!freshUser.isEmailVerified,
        isEmailVerified: !!freshUser.isEmailVerified,
        isMobileVerified: !!freshUser.isMobileVerified,
        lastSeen: freshUser.lastSeen || freshUser.updatedAt || freshUser.createdAt,
        fcmToken: freshUser.fcmToken,
      }
    });
  } catch (error) {
    console.error('Fetch profile error:', error);
    return res.status(500).json({ message: 'Server error while fetching profile.', error: error.message });
  }
};

/**
 * Get user profile by specified User ID
 */
exports.getUserById = async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    if (!targetUserId || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(200).json({
        message: 'Mock or invalid user ID; using local profile attributes',
        user: null
      });
    }

    const targetUser = await User.findById(targetUserId).select('-password');
    if (!targetUser) {
      return res.status(200).json({
        message: 'User profile not found in database',
        user: null
      });
    }

    const currentUserIdStr = req.user?._id ? req.user._id.toString() : '';
    const currentUser = currentUserIdStr ? await User.findById(currentUserIdStr) : null;
    const currentUserCoords = getUserCoordinates(currentUser);
    const targetCoords = getUserCoordinates(targetUser);

    let distanceText = '1 km away';
    if (currentUserCoords && targetCoords) {
      const kmVal = calculateHaversineDistance(
        currentUserCoords.lat,
        currentUserCoords.lng,
        targetCoords.lat,
        targetCoords.lng
      );
      const formatted = (Math.round(kmVal * 10) / 10).toString();
      distanceText = `${formatted} km away`;
    }

    // Filter out media hidden by target user for logged-in viewer
    const userHiddenMediaList = (targetUser.hiddenProfileMedia || [])
      .filter(item => item && item.hiddenForUserId && item.hiddenForUserId.toString() === currentUserIdStr)
      .map(item => item.mediaUrl);

    const validTargetProfileImages = (Array.isArray(targetUser.profileImages) ? targetUser.profileImages : [])
      .filter(p => p && typeof p === 'string' && p.trim().length > 0 && p !== 'null' && p !== 'undefined');

    const activeTargetSet = new Set(
      validTargetProfileImages.length > 0
        ? validTargetProfileImages
        : (targetUser.profileImage && targetUser.profileImage !== 'null' ? [targetUser.profileImage] : [])
    );

    const publicProfileImages = Array.from(activeTargetSet).filter(url => !userHiddenMediaList.includes(url));
    const publicPhotos = publicProfileImages.filter(p => !isBackendVideoUrl(p));
    const publicVideos = publicProfileImages.filter(p => isBackendVideoUrl(p));
    const publicMedia = publicProfileImages;

    let safeProfileImage = (targetUser.profileImage && activeTargetSet.has(targetUser.profileImage) && !userHiddenMediaList.includes(targetUser.profileImage))
      ? targetUser.profileImage
      : (publicProfileImages[0] || '');

    // Calculate age
    let computedAge = targetUser.age;
    if (!computedAge && targetUser.bdayYear) {
      const today = new Date();
      const yr = parseInt(targetUser.bdayYear, 10);
      const mo = parseInt(targetUser.bdayMonth, 10) || 1;
      const dy = parseInt(targetUser.bdayDay, 10) || 1;
      if (!isNaN(yr) && yr > 1900) {
        let calc = today.getFullYear() - yr;
        const monthDiff = (today.getMonth() + 1) - mo;
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dy)) {
          calc--;
        }
        if (calc >= 18 && calc <= 120) computedAge = calc;
      }
    }

    return res.status(200).json({
      message: 'User profile fetched successfully',
      user: {
        id: targetUser._id,
        _id: targetUser._id,
        name: targetUser.firstName || targetUser.name || 'Anonymous',
        firstName: targetUser.firstName || targetUser.name || 'Anonymous',
        age: computedAge || 24,
        bio: targetUser.bio || '',
        distance: distanceText,
        interests: targetUser.interests || [],
        languages: targetUser.languages || [],
        image: safeProfileImage,
        profileImage: safeProfileImage,
        profileImages: publicProfileImages,
        photos: publicPhotos,
        videos: publicVideos,
        media: publicMedia,
        gender: targetUser.gender || '',
        orientation: targetUser.orientation || '',
        lookingFor: targetUser.lookingFor || '',
        drinkHabit: targetUser.drinkHabit || '',
        smokeHabit: targetUser.smokeHabit || '',
        exercise: targetUser.exercise || '',
        pets: targetUser.pets || '',
        educationLevel: targetUser.educationLevel || '',
        zodiac: targetUser.zodiac || '',
        height: targetUser.height || '',
        weight: targetUser.weight || '',
        job: targetUser.job || '',
        college: targetUser.college || '',
        isOnline: checkIsOnline(targetUser),
        isVerified: !!targetUser.isEmailVerified,
        isEmailVerified: !!targetUser.isEmailVerified,
        isMobileVerified: !!targetUser.isMobileVerified,
        lastSeen: targetUser.lastSeen || targetUser.updatedAt || targetUser.createdAt,
      }
    });
  } catch (error) {
    console.error('Error in getUserById:', error);
    return res.status(500).json({ message: 'Server error fetching user profile.' });
  }
};

/**
 * Get other logged-in users (online users)
 */
exports.getOnlineUsers = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    const currentUserCoords = getUserCoordinates(currentUser);

    const activeOnlineIds = global.onlineUsers ? Array.from(global.onlineUsers.keys()) : [];

    const users = await User.find({
      _id: { $in: activeOnlineIds, $ne: req.user._id }
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
          image: u.profileImage || null,
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
 * Dedicated API: Heartbeat ping to maintain current user's Online status
 * POST /api/profile/presence
 */
exports.updatePresence = async (req, res) => {
  try {
    const userId = req.user._id;
    const now = new Date();
    const uIdStr = userId.toString();

    if (global.onlineUsers) {
      global.onlineUsers.set(uIdStr, true);
    }
    await User.findByIdAndUpdate(userId, { isLoggedIn: true, isOnline: true, lastSeen: now });

    if (global.io) {
      global.io.emit('user_status', { userId: uIdStr, status: 'online', isOnline: true });
    }

    return res.status(200).json({ success: true, isOnline: true, lastSeen: now });
  } catch (error) {
    console.error('Error updating presence:', error);
    return res.status(500).json({ success: false, message: 'Server error updating presence.' });
  }
};

/**
 * Dedicated API: Fetch online status map of all active users
 * GET /api/profile/online-status
 */
exports.getOnlineStatusMap = async (req, res) => {
  try {
    const activeSocketIds = global.onlineUsers ? Array.from(global.onlineUsers.keys()) : [];
    
    // Fetch users whose isOnline is true or lastSeen within last 5 minutes
    const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
    const dbOnlineUsers = await User.find({
      $or: [
        { _id: { $in: activeSocketIds } },
        { isOnline: true },
        { isLoggedIn: true, lastSeen: { $gte: fiveMinsAgo } }
      ]
    }).select('_id isOnline lastSeen');

    const onlineMap = {};
    const onlineUserIds = [];

    dbOnlineUsers.forEach(u => {
      const idStr = u._id.toString();
      onlineMap[idStr] = true;
      onlineUserIds.push(idStr);
    });

    activeSocketIds.forEach(idStr => {
      onlineMap[idStr] = true;
      if (!onlineUserIds.includes(idStr)) onlineUserIds.push(idStr);
    });

    return res.status(200).json({
      success: true,
      onlineUserIds,
      onlineMap
    });
  } catch (error) {
    console.error('Error fetching online status map:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching online status map.' });
  }
};

/**
 * Dedicated API: Fetch online status for a specific user ID
 * GET /api/profile/online-status/:userId
 */
exports.getUserOnlineStatus = async (req, res) => {
  try {
    const targetUserId = req.params.userId;
    if (!targetUserId) return res.status(400).json({ message: 'Missing userId parameter' });

    const targetUser = await User.findById(targetUserId).select('isOnline lastSeen isLoggedIn');
    const isOnline = checkIsOnline(targetUser);

    return res.status(200).json({
      success: true,
      userId: targetUserId,
      isOnline,
      lastSeen: targetUser?.lastSeen || null
    });
  } catch (error) {
    console.error('Error fetching user online status:', error);
    return res.status(500).json({ success: false, message: 'Server error.' });
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

    const ensureVideo15SecLimit = (url) => {
      if (!url || typeof url !== 'string') return url;
      const lower = url.toLowerCase();
      const isVideo = lower.includes('/video/upload/') || lower.includes('/video/') || /\.(mp4|mov|webm|3gp|mkv|avi|m4v|flv)($|\?|#)/i.test(lower);
      if (isVideo && url.includes('cloudinary.com') && url.includes('/video/upload/')) {
        if (!url.includes('/so_0,eo_15/') && !url.includes('/eo_15/') && !url.includes('/du_15/')) {
          return url.replace('/video/upload/', '/video/upload/so_0,eo_15/');
        }
      }
      return url;
    };

    // Helper to upload photos & videos to Cloudinary using Dating_Profiles preset
    const doCloudinaryUpload = async (inputData, mimetype = 'image/jpeg') => {
      const isVideo = mimetype && (mimetype.startsWith('video/') || mimetype.endsWith('.mp4') || mimetype.endsWith('.mov') || isBackendVideoUrl(mimetype) || isBackendVideoUrl(inputData));
      const resType = isVideo ? 'video' : 'auto';
      const uploadOptions = {
        folder: 'dating_app_profiles',
        resource_type: resType,
      };

      if (isVideo) {
        uploadOptions.transformation = [
          { start_offset: "0", end_offset: "15" }
        ];
      }

      let resultUrl = null;
      try {
        console.log(`Attempting Cloudinary unsigned_upload for ${isVideo ? 'video (trimmed to 15s)' : 'photo'}...`);
        const unsignedOptions = isVideo
          ? { resource_type: resType, transformation: [{ start_offset: "0", end_offset: "15" }] }
          : { resource_type: resType };
        const cloudRes = await cloudinary.uploader.unsigned_upload(inputData, 'Dating_Profiles', unsignedOptions);
        if (cloudRes && cloudRes.secure_url) {
          resultUrl = cloudRes.secure_url;
        }
      } catch (err1) {
        console.warn('Cloudinary unsigned_upload failed, trying signed upload:', err1.message || err1);
        try {
          const cloudRes = await cloudinary.uploader.upload(inputData, uploadOptions);
          if (cloudRes && cloudRes.secure_url) {
            resultUrl = cloudRes.secure_url;
          }
        } catch (err2) {
          console.warn('Cloudinary signed upload failed:', err2.message || err2);
        }
      }

      if (resultUrl && isVideo) {
        resultUrl = ensureVideo15SecLimit(resultUrl);
      }

      return resultUrl;
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

    const cleanFilter = (url) => typeof url === 'string' && url.trim().length > 0 && url !== 'null' && url !== imageUrl;

    let updatedImages = user.profileImages ? [...user.profileImages] : [];
    if (typeof index === 'number' && index >= 0 && index < 9) {
      updatedImages[index] = null;
    } else {
      updatedImages = updatedImages.map(img => img === imageUrl ? null : img);
    }

    const cleanProfileImages = updatedImages.filter(cleanFilter);
    user.profileImages = cleanProfileImages;
    user.photos = (user.photos || []).filter(cleanFilter);
    user.videos = (user.videos || []).filter(cleanFilter);
    user.media = (user.media || []).filter(cleanFilter);

    if (user.profileImage === imageUrl || index === 0 || !cleanProfileImages.includes(user.profileImage)) {
      user.profileImage = cleanProfileImages[0] || null;
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
    console.log(`[BACKEND FCM] PUT /api/profile/fcm-token requested by User ID: ${req.user?._id || req.user?.id}`);
    console.log(`[BACKEND FCM] Received fcmToken:`, fcmToken ? (fcmToken.substring(0, 30) + '...') : 'NULL / MISSING');

    if (!fcmToken) {
      console.warn(`[BACKEND FCM] ⚠️ Rejected: fcmToken was empty or missing in request body.`);
      return res.status(400).json({ message: 'FCM Token is required.' });
    }

    const updatedUser = await User.findByIdAndUpdate(req.user._id, { fcmToken }, { new: true });
    console.log(`[BACKEND FCM] ✅ SUCCESS: FCM Token saved in MongoDB for user ${req.user._id} (${updatedUser?.email || ''})`);
    return res.status(200).json({ message: 'FCM Token updated successfully.', saved: true });
  } catch (error) {
    console.error('[BACKEND FCM] ❌ Error updating FCM Token:', error);
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

/**
 * PUT /api/profile/hide-media
 * Body: { mediaUrl }
 * Adds mediaUrl to req.user's hiddenMedia array
 */
exports.hideProfileMedia = async (req, res) => {
  try {
    const { mediaUrl } = req.body;
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      return res.status(400).json({ success: false, message: 'mediaUrl is required.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $addToSet: { hiddenMedia: mediaUrl } },
      { new: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      message: 'Media hidden successfully.',
      hiddenMedia: user ? (user.hiddenMedia || []) : [],
      user,
    });
  } catch (error) {
    console.error('hideProfileMedia error:', error);
    return res.status(500).json({ success: false, message: 'Server error while hiding media.' });
  }
};

/**
 * PUT /api/profile/unhide-media
 * Body: { mediaUrl }
 * Removes mediaUrl from req.user's hiddenMedia array
 */
exports.unhideProfileMedia = async (req, res) => {
  try {
    const { mediaUrl } = req.body;
    if (!mediaUrl || typeof mediaUrl !== 'string') {
      return res.status(400).json({ success: false, message: 'mediaUrl is required.' });
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $pull: { hiddenMedia: mediaUrl } },
      { new: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      message: 'Media unhidden successfully.',
      hiddenMedia: user ? (user.hiddenMedia || []) : [],
      user,
    });
  } catch (error) {
    console.error('unhideProfileMedia error:', error);
    return res.status(500).json({ success: false, message: 'Server error while unhiding media.' });
  }
};

/**
 * GET /api/profile/hidden-media
 * Returns array of hidden media URLs for current user
 */
exports.getHiddenMedia = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('hiddenMedia');
    return res.status(200).json({
      success: true,
      hiddenMedia: user ? (user.hiddenMedia || []) : [],
    });
  } catch (error) {
    console.error('getHiddenMedia error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching hidden media.' });
  }
};

/**
 * POST / PUT /api/profile/main-photo
 * Upload or update main avatar photo (Slot #1)
 */
exports.uploadMainPhoto = async (req, res) => {
  try {
    const file = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    let imageUrl = req.body?.imageUrl || req.body?.photo || req.body?.url;

    if (file && file.path) {
      try {
        const cloudRes = await cloudinary.uploader.unsigned_upload(file.path, 'Dating_Profiles', { resource_type: 'image' });
        if (cloudRes && cloudRes.secure_url) imageUrl = cloudRes.secure_url;
      } catch (cErr) {
        const signedRes = await cloudinary.uploader.upload(file.path, { folder: 'dating_app_profiles' });
        if (signedRes && signedRes.secure_url) imageUrl = signedRes.secure_url;
      }
    }

    if (!imageUrl) {
      return res.status(400).json({ success: false, message: 'No valid image file or URL provided for main profile photo.' });
    }

    const currentUser = await User.findById(req.user._id);
    const updatedProfileImages = Array.isArray(currentUser?.profileImages) ? [...currentUser.profileImages] : [];
    if (updatedProfileImages.length > 0) {
      updatedProfileImages[0] = imageUrl;
    } else {
      updatedProfileImages.push(imageUrl);
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          profileImage: imageUrl,
          profileImages: updatedProfileImages,
        },
      },
      { new: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      message: 'Main profile photo updated successfully',
      profileImage: imageUrl,
      user: updatedUser,
    });
  } catch (error) {
    console.error('uploadMainPhoto error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating main profile photo.' });
  }
};

/**
 * DELETE /api/profile/main-photo
 * Clears main profile photo (Slot #1 remains blank)
 */
exports.removeMainPhoto = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    const oldMainPhoto = currentUser?.profileImage;

    const cleanFilter = (url) => typeof url === 'string' && url.trim().length > 0 && url !== 'null' && url !== oldMainPhoto;

    const updatedProfileImages = (currentUser?.profileImages || []).filter(cleanFilter);
    const updatedPhotos = (currentUser?.photos || []).filter(cleanFilter);
    const updatedVideos = (currentUser?.videos || []).filter(cleanFilter);
    const updatedMedia = (currentUser?.media || []).filter(cleanFilter);

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          profileImage: updatedProfileImages[0] || null,
          profileImages: updatedProfileImages,
          photos: updatedPhotos,
          videos: updatedVideos,
          media: updatedMedia,
        },
      },
      { new: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      message: 'Main profile photo removed successfully. Slot #1 is now blank.',
      profileImage: null,
      user: updatedUser,
    });
  } catch (error) {
    console.error('removeMainPhoto error:', error);
    return res.status(500).json({ success: false, message: 'Server error removing main profile photo.' });
  }
};

/**
 * POST / PUT /api/profile/gallery-media
 * Upload or update photo/video clip for gallery slots (Slots #2 - #9)
 */
exports.uploadGalleryMedia = async (req, res) => {
  try {
    const slotIndex = parseInt(req.body?.slotIndex ?? req.params?.slotIndex ?? 1, 10);
    const file = req.file || (req.files && req.files.length > 0 ? req.files[0] : null);
    let mediaUrl = req.body?.mediaUrl || req.body?.photo || req.body?.url;

    if (file && file.path) {
      const mime = file.mimetype || 'image/jpeg';
      const isVideo = mime.startsWith('video/') || /\.(mp4|mov|webm|3gp|mkv|avi|m4v)($|\?)/i.test(file.originalname || '');
      const resType = isVideo ? 'video' : 'auto';

      try {
        console.log(`[uploadGalleryMedia] Uploading ${resType} to Cloudinary...`, file.path);
        const cloudRes = await cloudinary.uploader.unsigned_upload(file.path, 'Dating_Profiles', { resource_type: resType });
        if (cloudRes && cloudRes.secure_url) {
          mediaUrl = cloudRes.secure_url;
        }
      } catch (cErr) {
        console.warn('[uploadGalleryMedia] unsigned_upload failed, attempting signed upload:', cErr.message);
        try {
          const signedRes = await cloudinary.uploader.upload(file.path, { folder: 'dating_app_profiles', resource_type: resType });
          if (signedRes && signedRes.secure_url) {
            mediaUrl = signedRes.secure_url;
          }
        } catch (sErr) {
          console.error('[uploadGalleryMedia] signed upload also failed:', sErr.message);
        }
      }

      // Automatically apply 15-second video trim transformation to Cloudinary URL
      if (mediaUrl && isVideo && mediaUrl.includes('cloudinary.com') && mediaUrl.includes('/video/upload/')) {
        if (!mediaUrl.includes('/so_0,eo_15/') && !mediaUrl.includes('/eo_15/')) {
          mediaUrl = mediaUrl.replace('/video/upload/', '/video/upload/so_0,eo_15/');
        }
      }
    }

    if (!mediaUrl) {
      return res.status(400).json({ success: false, message: 'No media file or URL provided for gallery slot.' });
    }

    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized.' });
    }

    const currentUser = await User.findById(req.user._id);
    if (!currentUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const photosArr = Array.isArray(currentUser.photos) ? [...currentUser.photos] : [];
    photosArr[slotIndex] = mediaUrl;

    const mediaArr = Array.isArray(currentUser.media) ? [...currentUser.media] : [];
    mediaArr[slotIndex] = mediaUrl;

    const videosArr = Array.isArray(currentUser.videos) ? [...currentUser.videos] : [];
    if (mediaUrl.includes('video') || /\.(mp4|mov|webm)($|\?)/i.test(mediaUrl)) {
      if (!videosArr.includes(mediaUrl)) {
        videosArr.push(mediaUrl);
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          photos: photosArr,
          media: mediaArr,
          videos: videosArr,
        },
      },
      { new: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      message: `Gallery slot #${slotIndex + 1} updated successfully`,
      mediaUrl,
      url: mediaUrl,
      secure_url: mediaUrl,
      slotIndex,
      user: updatedUser,
    });
  } catch (error) {
    console.error('[uploadGalleryMedia] Error:', error);
    return res.status(500).json({ success: false, message: 'Server error updating gallery media.', error: error.message || String(error) });
  }
};

/**
 * DELETE /api/profile/gallery-media/:slotIndex
 * Removes item from specific gallery slot
 */
exports.removeGalleryMedia = async (req, res) => {
  try {
    const slotIndex = parseInt(req.params?.slotIndex ?? req.body?.slotIndex ?? 1, 10);
    const currentUser = await User.findById(req.user._id);

    const targetUrl = (currentUser?.photos && currentUser.photos[slotIndex]) ||
                      (currentUser?.media && currentUser.media[slotIndex]) ||
                      (currentUser?.profileImages && currentUser.profileImages[slotIndex]);

    const cleanFilter = (url) => typeof url === 'string' && url.trim().length > 0 && url !== 'null' && url !== targetUrl;

    const photosArr = Array.isArray(currentUser?.photos) ? [...currentUser.photos] : [];
    if (slotIndex < photosArr.length) {
      photosArr[slotIndex] = null;
    }

    const mediaArr = Array.isArray(currentUser?.media) ? [...currentUser.media] : [];
    if (slotIndex < mediaArr.length) {
      mediaArr[slotIndex] = null;
    }

    const profileImagesArr = Array.isArray(currentUser?.profileImages) ? [...currentUser.profileImages] : [];
    if (slotIndex < profileImagesArr.length) {
      profileImagesArr[slotIndex] = null;
    }

    const cleanPhotos = photosArr.filter(cleanFilter);
    const cleanMedia = mediaArr.filter(cleanFilter);
    const cleanProfileImages = profileImagesArr.filter(cleanFilter);
    const cleanVideos = (currentUser?.videos || []).filter(cleanFilter);

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        $set: {
          profileImages: cleanProfileImages,
          photos: cleanPhotos,
          media: cleanMedia,
          videos: cleanVideos,
          profileImage: currentUser.profileImage === targetUrl ? (cleanProfileImages[0] || null) : currentUser.profileImage,
        },
      },
      { new: true }
    ).select('-password');

    return res.status(200).json({
      success: true,
      message: `Gallery slot #${slotIndex + 1} cleared successfully`,
      slotIndex,
      user: updatedUser,
    });
  } catch (error) {
    console.error('removeGalleryMedia error:', error);
    return res.status(500).json({ success: false, message: 'Server error clearing gallery media.' });
  }
};

/**
 * GET /api/profile/gallery-preview
 * Retrieves clean media list for gallery preview
 */
exports.getGalleryPreview = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id).select('profileImage profileImages photos videos media hiddenMedia');
    const hiddenSet = new Set(Array.isArray(currentUser?.hiddenMedia) ? currentUser.hiddenMedia : []);

    const rawPhotos = Array.isArray(currentUser?.photos) ? currentUser.photos : [];
    const validPhotos = rawPhotos.filter(p => typeof p === 'string' && p.trim().length > 0 && !hiddenSet.has(p));

    return res.status(200).json({
      success: true,
      mainPhoto: hiddenSet.has(currentUser?.profileImage) ? null : (currentUser?.profileImage || null),
      galleryPhotos: validPhotos,
      hiddenMedia: Array.from(hiddenSet),
    });
  } catch (error) {
    console.error('getGalleryPreview error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching gallery preview.' });
  }
};

/**
 * PUT /api/profile/fcm-token
 * Updates user's FCM device push token in MongoDB
 */
exports.updateFcmToken = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User session expired or invalid.' });
    }
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ success: false, message: 'FCM token is required' });
    }

    const userId = req.user._id;
    await User.findByIdAndUpdate(userId, { fcmToken });
    console.log(`[FCM] Successfully updated FCM token for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'FCM token updated successfully',
    });
  } catch (error) {
    console.error('Error in updateFcmToken:', error);
    return res.status(500).json({ success: false, message: 'Server error updating FCM token.' });
  }
};

/**
 * POST /api/profile/test-fcm-push
 * Diagnostic endpoint to test FCM push notification delivery
 */
exports.testFcmPush = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User session expired or invalid.' });
    }
    const userId = req.user._id;
    const user = await User.findById(userId).select('fcmToken name email');
    if (!user || !user.fcmToken) {
      return res.status(400).json({
        success: false,
        message: 'No FCM token registered for your user account. Please open the app on a real phone and log in.',
        user: { id: user?._id, name: user?.name, fcmToken: user?.fcmToken || null }
      });
    }

    const { sendPushNotification } = require('../services/pushNotificationService');
    const fcmResult = await sendPushNotification(userId, {
      title: '🎉 Push Notification Test',
      body: 'Your real-time Firebase Push Notifications are working perfectly!',
      data: { type: 'test', timestamp: Date.now().toString() }
    });

    return res.status(200).json({
      success: true,
      message: 'Push notification triggered to Firebase Cloud Messaging!',
      fcmTokenUsed: user.fcmToken.substring(0, 30) + '...',
      result: fcmResult || 'Dispatched'
    });
  } catch (error) {
    console.error('testFcmPush error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Error triggering test push notification.' });
  }
};

/**
 * GET /api/profile/fcm-token
 * Check if the currently authenticated user has an active FCM token registered
 */
exports.getFcmToken = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized: User session expired or invalid.' });
    }
    const user = await User.findById(req.user._id).select('firstName name email fcmToken isLoggedIn updatedAt');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.status(200).json({
      success: true,
      user: {
        id: user._id,
        name: user.firstName || user.name || user.email,
        fcmToken: user.fcmToken || null,
        hasFcmToken: !!(user.fcmToken && user.fcmToken.trim().length > 0),
        lastSeen: user.updatedAt,
      }
    });
  } catch (error) {
    console.error('getFcmToken error:', error);
    return res.status(500).json({ success: false, message: 'Server error checking FCM token.' });
  }
};

/**
 * GET /api/profile/my-reports
 * Fetch all reports filed by the logged-in user with reported user details
 */
exports.getMyReports = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized session.' });
    }

    const reports = await Report.find({ reporterId: req.user._id })
      .populate('reportedId', 'name firstName email age gender profileImage profileImages photos')
      .sort({ createdAt: -1 })
      .lean();

    const formattedReports = reports.map((rep) => {
      const reportedUser = rep.reportedId || {};
      const profileImage =
        reportedUser.profileImage ||
        (Array.isArray(reportedUser.profileImages) ? reportedUser.profileImages[0] : null) ||
        (Array.isArray(reportedUser.photos) ? reportedUser.photos[0] : null);

      return {
        _id: rep._id,
        reason: rep.reason,
        details: rep.details,
        status: rep.status || 'pending',
        createdAt: rep.createdAt,
        updatedAt: rep.updatedAt,
        reportedUser: {
          _id: reportedUser._id || null,
          name: reportedUser.name || reportedUser.firstName || 'User',
          firstName: reportedUser.firstName || reportedUser.name || 'User',
          email: reportedUser.email || '',
          age: reportedUser.age || null,
          gender: reportedUser.gender || '',
          profileImage: profileImage || null,
        },
      };
    });

    return res.status(200).json({
      success: true,
      count: formattedReports.length,
      reports: formattedReports,
    });
  } catch (error) {
    console.error('getMyReports error:', error);
    return res.status(500).json({ success: false, message: 'Server error fetching user reports.' });
  }
};

/**
 * GET /api/profile/active-warning
 * Checks if logged-in user has an active, unacknowledged warning from Admin
 */
exports.getActiveWarning = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized session.' });
    }

    const user = await User.findById(req.user._id).select('warnings name firstName email');
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const warnings = user.warnings || [];
    const activeWarning = warnings.find((w) => w.isAcknowledged === false);

    if (!activeWarning) {
      return res.status(200).json({
        success: true,
        hasWarning: false,
        warning: null,
      });
    }

    return res.status(200).json({
      success: true,
      hasWarning: true,
      warning: {
        _id: activeWarning._id,
        category: activeWarning.category,
        message: activeWarning.message,
        severity: activeWarning.severity,
        issuedBy: activeWarning.issuedBy,
        issuedAt: activeWarning.issuedAt,
        isAcknowledged: activeWarning.isAcknowledged,
      },
    });
  } catch (error) {
    console.error('getActiveWarning error:', error);
    return res.status(500).json({ success: false, message: 'Server error checking active user warning.' });
  }
};

/**
 * POST /api/profile/acknowledge-warning
 * Reported user acknowledges an official warning from Admin
 */
exports.acknowledgeWarning = async (req, res) => {
  try {
    if (!req.user || !req.user._id) {
      return res.status(401).json({ success: false, message: 'Unauthorized session.' });
    }

    const { warningId } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const warnings = user.warnings || [];
    let targetWarn = null;

    if (warningId) {
      targetWarn = warnings.id(warningId) || warnings.find((w) => w._id.toString() === warningId.toString());
    } else {
      targetWarn = warnings.find((w) => w.isAcknowledged === false);
    }

    if (!targetWarn) {
      return res.status(404).json({ success: false, message: 'Active warning not found.' });
    }

    targetWarn.isAcknowledged = true;
    targetWarn.acknowledgedAt = new Date();
    await user.save();

    // Update matching report status in Reports collection to resolved and set isAcknowledged
    try {
      const Report = require('../models/Report');
      const now = new Date();
      await Report.updateMany(
        { reportedId: user._id },
        { 
          $set: { 
            status: 'resolved', 
            isAcknowledged: true,
            acknowledgedAt: now,
            details: 'Report Viewed & Acknowledged' 
          } 
        }
      );
    } catch (repErr) {
      console.error('Error updating report status on acknowledge:', repErr);
    }

    // Broadcast warning_acknowledged event to live socket clients / admin listeners
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('warning_acknowledged', {
          userId: user._id,
          warningId: targetWarn._id,
          acknowledgedAt: targetWarn.acknowledgedAt,
        });
      }
    } catch (sErr) {}

    return res.status(200).json({
      success: true,
      message: 'Warning acknowledged successfully.',
      warning: targetWarn,
    });
  } catch (error) {
    console.error('acknowledgeWarning error:', error);
    return res.status(500).json({ success: false, message: 'Server error acknowledging warning.' });
  }
};

/**
 * PUT /api/profile/visibility
 * Toggle or set Profile Visibility (Hide My Profile from discovery / Show My Profile)
 */
exports.updateProfileVisibility = async (req, res) => {
  try {
    const { isProfileHidden, isHidden } = req.body || {};
    const hideVal = isProfileHidden !== undefined ? !!isProfileHidden : (isHidden !== undefined ? !!isHidden : true);

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { isProfileHidden: hideVal } },
      { new: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    console.log(`[updateProfileVisibility] User ${req.user._id} updated isProfileHidden to: ${hideVal}`);

    return res.status(200).json({
      success: true,
      message: hideVal
        ? 'Your profile is now hidden. It will not be shown to other users in candidate discovery or search.'
        : 'Your profile is now visible to other users in candidate discovery and search.',
      isProfileHidden: updatedUser.isProfileHidden,
      user: {
        id: updatedUser._id,
        _id: updatedUser._id,
        isProfileHidden: updatedUser.isProfileHidden,
      },
    });
  } catch (error) {
    console.error('Error updating profile visibility:', error);
    return res.status(500).json({ success: false, message: 'Server error while updating profile visibility.' });
  }
};
