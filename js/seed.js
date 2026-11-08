// Sample records for demos. Dates are generated relative to "today" so the dashboard
// always shows a realistic week. Items are flagged `demo: true`: they never sync to
// Google Sheets and can be removed in one click from Settings.
import { toISODate, uid } from './domain.js';

function dayOffset(days, now) {
  return toISODate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

export function buildDemoData(now = new Date()) {
  const createdAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 8).toISOString();
  const meds = [
    { medicineName: 'Metformin 500mg', dosage: '1 tablet after meals', times: ['08:00', '20:00'], phoneNumber: '+919876543210' },
    { medicineName: 'Amlodipine 5mg', dosage: '1 tablet', times: ['09:00'], phoneNumber: '' },
    { medicineName: 'Vitamin D3 60K', dosage: '1 capsule with milk', times: ['13:30'], phoneNumber: '' },
  ].map((m) => ({ id: uid('med'), ...m, timing: m.times.join(', '), active: true, smsEnabled: Boolean(m.phoneNumber), startDate: dayOffset(-7, now), createdAt, demo: true }));

  // ~85% adherence pattern: skip a few doses deterministically.
  const skipped = new Set(['1|20:00', '3|09:00', '4|13:30', '5|20:00']);
  const doseLogs = [];
  for (let back = 6; back >= 1; back -= 1) {
    meds.forEach((med) => med.times.forEach((time) => {
      if (skipped.has(`${back}|${time}`)) return;
      doseLogs.push({ id: uid('dose'), medicationId: med.id, date: dayOffset(-back, now), time, takenAt: new Date().toISOString(), demo: true });
    }));
  }
  doseLogs.push({ id: uid('dose'), medicationId: meds[0].id, date: dayOffset(0, now), time: '08:00', takenAt: new Date().toISOString(), demo: true });

  const apt = (offset, time, extra) => ({ id: uid('apt'), date: dayOffset(offset, now), time, status: 'scheduled', createdAt, demo: true, patientName: 'Rahul Kumar', ...extra });
  const appointments = [
    apt(-5, '10:30', { doctorName: 'Dr. Ananya Rao', title: 'Diabetes review', notes: 'Bring last 3 months glucose readings', status: 'completed' }),
    apt(-2, '17:00', { doctorName: 'Dr. Vikram Shah', title: 'Blood pressure check', notes: 'Fasting not required' }),
    apt(1, '11:00', { doctorName: 'Dr. Ananya Rao', title: 'HbA1c lab results', notes: 'Discuss diet plan' }),
    apt(4, '16:15', { doctorName: 'Dr. Meera Iyer', title: 'Eye examination', notes: 'Diabetic retinopathy screening' }),
  ];

  const summaries = [{
    id: uid('sum'),
    patientName: 'Rahul Kumar',
    appointmentId: appointments[0].id,
    rawNotes: 'Pt c/o fatigue. FBS 148, PPBS 210. HbA1c 7.6. Continue metformin 500 BD. Add walking 30 min daily. Reduce sugar. Review in 4 weeks with HbA1c.',
    summary: [
      'Visit Overview:',
      '- You visited for a diabetes review because you have been feeling tired.',
      'Diagnosis:',
      '- Your blood sugar is higher than the target range (HbA1c 7.6%). This means diabetes is not fully controlled yet.',
      'Medicine Instructions:',
      '- Keep taking Metformin 500mg twice a day after meals.',
      'Follow-up Advice:',
      '- Walk for 30 minutes every day and cut down on sugary foods.',
      '- Come back in 4 weeks for a repeat HbA1c test.',
    ].join('\n'),
    model: 'llama-3.3-70b-versatile',
    createdAt: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 5, 11, 5).toISOString(),
    demo: true,
  }];

  return { appointments, medications: meds, doseLogs, summaries };
}
