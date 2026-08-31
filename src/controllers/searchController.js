const User = require('../models/User');
const Block = require('../models/Block');

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
  if (user.lastSeen) {
    const diff = Date.now() - new Date(user.lastSeen).getTime();
    if (!isNaN(diff) && diff < 60 * 1000) return true;
  }
  return false;
};

/**
 * Helper function to calculate Haversine distance in kilometers
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
 * Helper function to compute precise age from birthday fields or age property
 */
function computeUserAge(user) {
  let candidateAge = parseInt(user.age, 10);
  if (user.bdayYear && user.bdayMonth && user.bdayDay) {
    const year = parseInt(user.bdayYear, 10);
    const month = parseInt(user.bdayMonth, 10);
    const day = parseInt(user.bdayDay, 10);
    if (year > 1900) {
      const today = new Date();
      let calc = today.getFullYear() - year;
      const monthDiff = today.getMonth() + 1 - month;
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
        calc--;
      }
      if (calc >= 18 && calc <= 120) {
        candidateAge = calc;
      }
    }
  }
  return candidateAge || null;
}

/**
 * Advanced Search API with filter combinations:
 * - Age Range (ageMin, ageMax)
 * - Distance Range (distanceKm)
 * - Interests (array match / overlap)
 * - Languages (array match / overlap)
 * - Profession / Job (regex text search)
 * - Lifestyle Preferences (drinkHabit, smokeHabit, exercise, pets, educationLevel, zodiac, lookingFor)
 * - Pagination & Sorting
 */
exports.advancedSearch = async (req, res) => {
  try {
    const currentUser = await User.findById(req.user._id);
    if (!currentUser) {
      return res.status(404).json({ message: 'Current user not found' });
    }

    // Combine request body and query parameters for flexibility (POST / GET support)
    const body = { ...req.query, ...req.body };

    const {
      searchKeyword,
      query,
      ageMin,
      ageMax,
      distanceKm,
      gender,
      profession,
      interests,
      languages,
      lifestyle = {},
      sortBy = 'matchPercentage',
      page = 1,
      limit = 20,
    } = body;

    // Parse numerical parameters
    const minAge = parseInt(ageMin, 10) || 18;
    const maxAge = parseInt(ageMax, 10) || 100;
    const maxDistanceKm = parseFloat(distanceKm) || currentUser.distanceRange || 50;
    const maxDistanceMeters = maxDistanceKm * 1000;

    const currentPage = Math.max(1, parseInt(page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));

    // Get blocked user IDs to exclude from search
    const blocks = await Block.find({
      $or: [{ blockerId: req.user._id }, { blockedId: req.user._id }],
    });
    const blockedIds = blocks.map((b) =>
      b.blockerId.toString() === req.user._id.toString() ? b.blockedId : b.blockerId
    );

    // Build MongoDB Query (Exclude current user and blocked profiles)
    const mongoQuery = {
      _id: { $ne: req.user._id, $nin: blockedIds },
    };

    // Text Search (Name, Profession, College, Bio, Location)
    const textQuery = (searchKeyword || query || profession || '').toString().trim();
    if (textQuery && textQuery !== 'All') {
      const regex = new RegExp(textQuery, 'i');
      mongoQuery.$or = [
        { firstName: regex },
        { lastName: regex },
        { name: regex },
        { job: regex },
        { college: regex },
        { bio: regex },
        { locationName: regex },
        { city: regex },
      ];
    }

    // Gender Filter
    const targetGender = gender || currentUser.interestedIn;
    if (targetGender && targetGender !== 'Everyone' && targetGender !== 'All') {
      if (targetGender === 'Women' || targetGender === 'Female') {
        mongoQuery.gender = { $in: ['Women', 'Female', 'Woman'] };
      } else if (targetGender === 'Male' || targetGender === 'Men') {
        mongoQuery.gender = { $in: ['Male', 'Man', 'Men'] };
      } else {
        mongoQuery.gender = targetGender;
      }
    }

    // Interests Filter
    if (interests) {
      const interestsArray = Array.isArray(interests)
        ? interests
        : typeof interests === 'string'
        ? interests.split(',').map((i) => i.trim())
        : [];
      if (interestsArray.length > 0) {
        mongoQuery.interests = { $in: interestsArray };
      }
    }

    // Languages Filter
    if (languages) {
      const languagesArray = Array.isArray(languages)
        ? languages
        : typeof languages === 'string'
        ? languages.split(',').map((l) => l.trim())
        : [];
      if (languagesArray.length > 0) {
        mongoQuery.languages = { $in: languagesArray };
      }
    }

    // Lifestyle Preferences Filter (supports individual attributes or nested lifestyle object)
    const drinkHabitFilter = lifestyle.drinkHabit || body.drinkHabit;
    const smokeHabitFilter = lifestyle.smokeHabit || body.smokeHabit;
    const exerciseFilter = lifestyle.exercise || body.exercise;
    const petsFilter = lifestyle.pets || body.pets;
    const educationFilter = lifestyle.educationLevel || body.educationLevel;
    const zodiacFilter = lifestyle.zodiac || body.zodiac;
    const lookingForFilter = lifestyle.lookingFor || body.lookingFor;

    const buildInFilter = (filterVal) => {
      if (!filterVal) return null;
      if (Array.isArray(filterVal) && filterVal.length > 0) return { $in: filterVal };
      if (typeof filterVal === 'string' && filterVal.trim() !== '') {
        const parts = filterVal.split(',').map((s) => s.trim());
        return { $in: parts };
      }
      return null;
    };

    if (buildInFilter(drinkHabitFilter)) mongoQuery.drinkHabit = buildInFilter(drinkHabitFilter);
    if (buildInFilter(smokeHabitFilter)) mongoQuery.smokeHabit = buildInFilter(smokeHabitFilter);
    if (buildInFilter(exerciseFilter)) mongoQuery.exercise = buildInFilter(exerciseFilter);
    if (buildInFilter(petsFilter)) mongoQuery.pets = buildInFilter(petsFilter);
    if (buildInFilter(educationFilter)) mongoQuery.educationLevel = buildInFilter(educationFilter);
    if (buildInFilter(zodiacFilter)) mongoQuery.zodiac = buildInFilter(zodiacFilter);
    if (buildInFilter(lookingForFilter)) mongoQuery.lookingFor = buildInFilter(lookingForFilter);

    // Active User Location coordinates prioritization
    const activeCoords =
      currentUser.currentLocation?.location?.coordinates ||
      currentUser.permanentAddress?.location?.coordinates ||
      currentUser.location?.coordinates;

    const hasLocation = Array.isArray(activeCoords) && activeCoords.length === 2;
    let users = [];

    // Attempt GeoNear spatial query if coordinates exist
    if (hasLocation) {
      const [lng, lat] = activeCoords;
      try {
        users = await User.aggregate([
          {
            $geoNear: {
              near: { type: 'Point', coordinates: [lng, lat] },
              distanceField: 'calculatedDistanceMeters',
              maxDistance: maxDistanceMeters,
              spherical: true,
              query: mongoQuery,
            },
          },
        ]);
      } catch (geoErr) {
        console.error('MongoDB $geoNear failed in search, falling back to standard find:', geoErr.message);
        users = [];
      }
    }

    // Standard MongoDB query fallback if $geoNear returns empty or user has no location
    if (users.length === 0) {
      users = await User.find(mongoQuery).lean();

      if (hasLocation) {
        const [userLng, userLat] = activeCoords;
        users = users.filter((u) => {
          const coords =
            u.currentLocation?.location?.coordinates ||
            u.permanentAddress?.location?.coordinates ||
            u.location?.coordinates;
          if (Array.isArray(coords) && coords.length === 2) {
            const distKm = calculateHaversineDistance(userLat, userLng, coords[1], coords[0]);
            u.calculatedDistanceMeters = distKm * 1000;
            return distKm <= maxDistanceKm;
          }
          return true; // Keep candidate if candidate location missing
        });
      }
    }

    // Filter by Age Range & decorate users with calculated metrics
    const userInterests = currentUser.interests || [];
    const userLanguages = currentUser.languages || [];

    const searchInterests = Array.isArray(interests)
      ? interests
      : typeof interests === 'string'
      ? interests.split(',').map((i) => i.trim())
      : userInterests;

    const searchLanguages = Array.isArray(languages)
      ? languages
      : typeof languages === 'string'
      ? languages.split(',').map((l) => l.trim())
      : userLanguages;

    const filteredUsers = [];

    for (const u of users) {
      const candidateAge = computeUserAge(u);
      u.age = candidateAge || u.age || null;

      if (u.age && (u.age < minAge || u.age > maxAge)) {
        continue; // Skip user outside age range
      }

      // Calculate distance in kilometers
      const distanceKmVal = u.calculatedDistanceMeters
        ? parseFloat((u.calculatedDistanceMeters / 1000).toFixed(1))
        : null;
      u.calculatedDistanceKm = distanceKmVal;

      // Intersect interests & languages
      const candidateInterests = u.interests || [];
      const commonInterests = candidateInterests.filter((i) => searchInterests.includes(i));

      const candidateLanguages = u.languages || [];
      const commonLanguages = candidateLanguages.filter((l) => searchLanguages.includes(l));

      // Compute match score (0 - 100%)
      let score = 0;
      if (searchInterests.length > 0) {
        score += Math.round((commonInterests.length / searchInterests.length) * 60);
      } else {
        score += 30;
      }

      if (searchLanguages.length > 0) {
        score += Math.round((commonLanguages.length / searchLanguages.length) * 20);
      } else {
        score += 10;
      }

      if (u.lookingFor && currentUser.lookingFor && u.lookingFor === currentUser.lookingFor) {
        score += 10;
      }

      if (u.drinkHabit && currentUser.drinkHabit && u.drinkHabit === currentUser.drinkHabit) {
        score += 5;
      }

      if (u.smokeHabit && currentUser.smokeHabit && u.smokeHabit === currentUser.smokeHabit) {
        score += 5;
      }

      u.commonInterests = commonInterests;
      u.commonInterestsCount = commonInterests.length;
      u.commonLanguages = commonLanguages;
      u.matchPercentage = Math.min(100, score);

      filteredUsers.push(u);
    }

    // Sort results based on sortBy parameter
    if (sortBy === 'distance') {
      filteredUsers.sort((a, b) => (a.calculatedDistanceKm ?? 9999) - (b.calculatedDistanceKm ?? 9999));
    } else if (sortBy === 'age') {
      filteredUsers.sort((a, b) => (a.age ?? 0) - (b.age ?? 0));
    } else if (sortBy === 'recent') {
      filteredUsers.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    } else {
      // Default: matchPercentage
      filteredUsers.sort((a, b) => b.matchPercentage - a.matchPercentage);
    }

    // Pagination calculations
    const totalCount = filteredUsers.length;
    const totalPages = Math.ceil(totalCount / pageSize) || 1;
    const startIndex = (currentPage - 1) * pageSize;
    const paginatedUsers = filteredUsers.slice(startIndex, startIndex + pageSize);

    // Format output users to exclude sensitive fields and hidden media items
    const formattedUsers = paginatedUsers.map((user) => {
      const hiddenSet = new Set(Array.isArray(user.hiddenMedia) ? user.hiddenMedia : []);

      const validImages = (Array.isArray(user.profileImages) ? user.profileImages : [])
        .filter((p) => p && typeof p === 'string' && p.trim().length > 0 && p !== 'null' && p !== 'undefined');

      const activeSet = new Set(
        validImages.length > 0
          ? validImages
          : (user.profileImage && user.profileImage !== 'null' ? [user.profileImage] : [])
      );

      const publicProfileImages = Array.from(activeSet).filter((p) => !hiddenSet.has(p));
      const publicPhotos = publicProfileImages.filter((p) => !isBackendVideoUrl(p));
      const publicVideos = publicProfileImages.filter((p) => isBackendVideoUrl(p));
      const publicMedia = publicProfileImages;

      const safeProfileImage = (user.profileImage && activeSet.has(user.profileImage) && !hiddenSet.has(user.profileImage))
        ? user.profileImage
        : (publicProfileImages[0] || null);

      return {
        _id: user._id,
        id: user._id,
        name: user.name,
        firstName: user.firstName,
        age: user.age,
        gender: user.gender,
        job: user.job,
        college: user.college,
        bio: user.bio,
        profileImage: safeProfileImage,
        profileImages: publicProfileImages,
        photos: publicPhotos,
        videos: publicVideos,
        media: publicMedia,
        interests: user.interests || [],
        languages: user.languages || [],
        commonInterests: user.commonInterests || [],
        commonInterestsCount: user.commonInterestsCount || 0,
        commonLanguages: user.commonLanguages || [],
        matchPercentage: user.matchPercentage || 0,
        calculatedDistanceKm: user.calculatedDistanceKm,
        drinkHabit: user.drinkHabit,
        smokeHabit: user.smokeHabit,
        exercise: user.exercise,
        pets: user.pets,
        educationLevel: user.educationLevel,
        zodiac: user.zodiac,
        lookingFor: user.lookingFor,
        orientation: user.orientation,
        isOnline: checkIsOnline(user),
        isLoggedIn: checkIsOnline(user),
        isVerified: !!user.isEmailVerified,
        isEmailVerified: !!user.isEmailVerified,
        isMobileVerified: !!user.isMobileVerified,
        lastSeen: user.lastSeen || user.updatedAt || user.createdAt,
      };
    });

    return res.status(200).json({
      success: true,
      totalCount,
      page: currentPage,
      limit: pageSize,
      totalPages,
      users: formattedUsers,
    });
  } catch (error) {
    console.error('Advanced Search Error:', error);
    return res.status(500).json({ message: 'Server error while executing advanced search.' });
  }
};

/**
 * Get Search Master Filter Options
 * Provides static/master dataset of available options for search UI chips and dropdowns
 */
exports.getFilterOptions = async (req, res) => {
  try {
    const options = {
      interests: [
        'Music',
        'Travel',
        'Fitness',
        'Gaming',
        'Photography',
        'Cooking',
        'Art',
        'Tech',
        'Movies',
        'Reading',
        'Dancing',
        'Sports',
        'Fashion',
        'Yoga',
        'Hiking',
      ],
      languages: [
        'English',
        'Spanish',
        'French',
        'German',
        'Hindi',
        'Marathi',
        'Mandarin',
        'Japanese',
        'Arabic',
        'Russian',
        'Portuguese',
      ],
      professions: [
        'Software Engineer',
        'Doctor',
        'Designer',
        'Teacher',
        'Entrepreneur',
        'Student',
        'Architect',
        'Marketer',
        'Accountant',
        'Lawyer',
        'Artist',
      ],
      drinkHabits: ['Never', 'Socially', 'Regularly'],
      smokeHabits: ['No', 'Socially', 'Regularly'],
      exerciseHabits: ['Active', 'Sometimes', 'Never'],
      petsOptions: ['Dog lover', 'Cat lover', 'No pets', 'Has pets'],
      educationLevels: ['High School', 'Bachelors', 'Masters', 'PhD'],
      zodiacSigns: [
        'Aries',
        'Taurus',
        'Gemini',
        'Cancer',
        'Leo',
        'Virgo',
        'Libra',
        'Scorpio',
        'Sagittarius',
        'Capricorn',
        'Aquarius',
        'Pisces',
      ],
      lookingForOptions: ['Long-term relationship', 'Casual dating', 'Friendship', 'Not sure'],
      sortOptions: [
        { label: 'Match Percentage', value: 'matchPercentage' },
        { label: 'Distance', value: 'distance' },
        { label: 'Age', value: 'age' },
        { label: 'Recently Added', value: 'recent' },
      ],
    };

    return res.status(200).json({
      success: true,
      options,
    });
  } catch (error) {
    console.error('Get Filter Options Error:', error);
    return res.status(500).json({ message: 'Server error while fetching filter options.' });
  }
};

/**
 * Get User Saved Search Preferences
 */
exports.getSearchPreferences = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('searchPreferences ageRangeMin ageRangeMax distanceRange interestedIn');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const defaultPrefs = {
      ageMin: user.ageRangeMin || 18,
      ageMax: user.ageRangeMax || 100,
      distanceKm: user.distanceRange || 50,
      gender: user.interestedIn || 'Everyone',
      interests: [],
      languages: [],
      profession: '',
      lifestyle: {},
      sortBy: 'matchPercentage',
    };

    const preferences = { ...defaultPrefs, ...(user.searchPreferences || {}) };

    return res.status(200).json({
      success: true,
      preferences,
    });
  } catch (error) {
    console.error('Get Search Preferences Error:', error);
    return res.status(500).json({ message: 'Server error while fetching search preferences.' });
  }
};

/**
 * Save / Update User Search Preferences
 */
exports.updateSearchPreferences = async (req, res) => {
  try {
    const newPreferences = req.body;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { searchPreferences: newPreferences } },
      { new: true, runValidators: true }
    ).select('searchPreferences');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.status(200).json({
      message: 'Search preferences updated successfully',
      preferences: user.searchPreferences,
    });
  } catch (error) {
    console.error('Update Search Preferences Error:', error);
    return res.status(500).json({ message: 'Server error while updating search preferences.' });
  }
};
