const profileController = require('./profileController');

/**
 * Master Dataset for Questionnaire Questions & Options
 */
const QUESTIONNAIRE_OPTIONS = {
  interests: [
    '🎵 Music',
    '✈️ Travel',
    '🏋️ Fitness',
    '🎬 Movies',
    '🎮 Gaming',
    '🍳 Cooking',
    '🎨 Art',
    '📸 Photography',
    '📚 Reading',
    '💃 Dancing',
    '☕ Coffee',
    '🐕 Pets',
    '🍷 Wine',
    '🧘 Yoga',
    '🍕 Foodie',
    '🏕️ Camping',
  ],
  orientations: ['Straight', 'Gay', 'Lesbian', 'Bisexual', 'Pansexual', 'Queer'],
  lookingFor: ['Long-term Relationship', 'Short-term Fun', 'New Friends', 'Still Figuring It Out'],
  drinkHabits: ['Never', 'Socially', 'Frequently'],
  smokeHabits: ['Never', 'Socially', 'Regularly'],
  exerciseHabits: ['Active', 'Sometimes', 'Never'],
  petsOptions: ['Dog', 'Cat', 'Both', 'None'],
  educationLevels: [
    '🎓 High School',
    '🎓 Bachelors Degree',
    '🎓 Masters Degree',
    '🎓 Doctorate / PhD',
    '🛠️ Trade / Vocational',
    '💼 Other Education',
  ],
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
  languageOptions: [
    'English',
    'Hindi',
    'Spanish',
    'French',
    'German',
    'Marathi',
    'Mandarin',
    'Japanese',
    'Italian',
    'Portuguese',
    'Russian',
    'Arabic',
  ],
  jobExamples: [
    '💻 Software Engineer',
    '👩‍🏫 Teacher',
    '🩺 Doctor',
    '🎓 Student',
    '💼 Business Owner',
  ],
  heightOptions: [
    "5'2\" (157 cm)",
    "5'4\" (163 cm)",
    "5'6\" (168 cm)",
    "5'8\" (173 cm)",
    "5'10\" (178 cm)",
    "6'0\" (183 cm)",
    "6'2\" (188 cm)",
  ],
  weightOptions: [
    "50 kg (110 lbs)",
    "55 kg (121 lbs)",
    "60 kg (132 lbs)",
    "65 kg (143 lbs)",
    "70 kg (154 lbs)",
    "75 kg (165 lbs)",
    "80 kg (176 lbs)",
    "85 kg (187 lbs)",
  ],
  genderOptions: ['Women', 'Male', 'Non-binary'],
  interestedInOptions: ['Men', 'Women', 'Everyone'],
};

/**
 * GET /api/questionnaire/options
 * Returns master options for all questionnaire steps
 */
exports.getQuestionnaireOptions = async (req, res) => {
  try {
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

exports.QUESTIONNAIRE_OPTIONS = QUESTIONNAIRE_OPTIONS;

// Forward profileController questionnaire methods
exports.saveQuestionnaire = profileController.saveQuestionnaire;
exports.getQuestionnaires = profileController.getQuestionnaires;
exports.getProfile = profileController.getProfile;
