/**
 * Stored values shown through tData(): they are saved in Swahili whatever the
 * screen language, so every device and report reads the same record, and are
 * only put into English when shown.
 */
const data: Record<string, string> = {
  // Expense categories (Matumizi)
  'Kodi': 'Rent',
  'Umeme': 'Electricity',
  'Maji': 'Water',
  'Usafiri': 'Transport',
  'Mishahara': 'Salaries',
  'Chakula': 'Food',
  'Matengenezo': 'Repairs',
  'Mengineyo': 'Other',
  // Expense categories (past-day expenses in Historia)
  'Kodi ya pango': 'Rent / Shop space',
  'Maji ya duka': 'Water and cleaning',
  'Umeme wa duka': 'Electricity / LUKU',
  'Mikopo & riba': 'Loan repayments / Interest',
  'Usafiri & mizigo': 'Transport and carrying goods',
  'Chakula & vinywaji': 'Food and drinks',
  'Mishahara ya duka': 'Salaries and allowances',
  'Ulinzi & usalama': 'Security',
  'Ukarabati & fanicha': 'Repairs and equipment',
  'Kodi ya serikali/Laini': 'Government tax / Permit',
  // Descriptions written when the user leaves the field empty
  'Maelezo hayakuwekwa': 'No description given',
  'Maelezo ya asili ya kipindi kilichopita': 'Default description for a past period',
  // The kind of device in a device's stored name
  'Simu': 'Phone',
  'Kompyuta': 'Computer',
  // How a product's sales are moving (V Smart)
  'inapanda': 'rising',
  'inashuka': 'falling',
  'tulivu': 'steady',
  'imeanza kuuzika wiki hii': 'started selling this week',
};

export default data;
