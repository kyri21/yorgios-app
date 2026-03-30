import jsPDF from 'jspdf'
import type { Employee, MonthlyEmployeeStats } from '../types'

export function exportMonthlyPDF(month: Date, employees: Employee[], stats: MonthlyEmployeeStats[]) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })

  const title = month.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  const pageW = 297
  const margin = 10

  // Fond et titre
  doc.setFontSize(14)
  doc.setTextColor(255, 255, 255)
  doc.setFillColor(15, 23, 42)
  doc.rect(0, 0, pageW, 210, 'F')
  doc.setFillColor(30, 41, 59)
  doc.rect(margin, margin, pageW - margin * 2, 12, 'F')
  doc.text(`Planning Matias — ${title}`, margin + 4, margin + 8.5)

  // En-têtes colonnes
  const colLabels = ['Employé', 'Heures', 'Supp', 'Congés', 'S.Solde', 'Absences', 'Retard', 'J.Off']
  const colW = [40, 20, 18, 20, 20, 24, 24, 18]
  const tableX = margin
  const headerY = margin + 16
  const rowH = 9

  // Header row
  doc.setFillColor(37, 99, 235)
  let cx = tableX
  colW.forEach(w => {
    doc.rect(cx, headerY, w, rowH, 'F')
    cx += w
  })
  doc.setFontSize(8)
  doc.setTextColor(255, 255, 255)
  cx = tableX
  colLabels.forEach((label, i) => {
    doc.text(label, cx + 2, headerY + 6)
    cx += colW[i]
  })

  // Data rows
  doc.setFontSize(8)
  stats.forEach((stat, rowIdx) => {
    const y = headerY + rowH * (rowIdx + 1)
    if (rowIdx % 2 === 0) {
      doc.setFillColor(22, 32, 50)
    } else {
      doc.setFillColor(17, 24, 39)
    }
    cx = tableX
    const totalW = colW.reduce((a, b) => a + b, 0)
    doc.rect(cx, y, totalW, rowH, 'F')

    const emp = employees.find(e => e.id === stat.empId)
    if (emp) {
      const hex = emp.color.replace('#', '')
      const r = parseInt(hex.slice(0, 2), 16)
      const g = parseInt(hex.slice(2, 4), 16)
      const b = parseInt(hex.slice(4, 6), 16)
      doc.setFillColor(r, g, b)
      doc.rect(cx + 2, y + 2.5, 4, 4, 'F')
    }

    const values = [
      stat.name,
      `${stat.total.heuresTravaillees}h`,
      `${stat.total.heuresSupp}h`,
      `${stat.total.conges}j`,
      `${stat.total.sansSolde}j`,
      `${stat.total.absences}j`,
      `${stat.total.retardMinutes}min`,
      `${stat.total.joursOff}j`,
    ]
    doc.setTextColor(226, 232, 240)
    cx = tableX
    values.forEach((val, i) => {
      const offsetX = i === 0 ? 8 : 2
      doc.text(val, cx + offsetX, y + 6)
      cx += colW[i]
    })
  })

  // Lignes de grille
  doc.setDrawColor(51, 65, 85)
  doc.setLineWidth(0.2)
  const tableW = colW.reduce((a, b) => a + b, 0)
  const tableH = rowH * (1 + stats.length)
  // Horizontales
  for (let r = 0; r <= stats.length + 1; r++) {
    const ly = headerY + r * rowH
    doc.line(tableX, ly, tableX + tableW, ly)
  }
  // Verticales
  cx = tableX
  colW.forEach(w => {
    doc.line(cx, headerY, cx, headerY + tableH)
    cx += w
  })
  doc.line(cx, headerY, cx, headerY + tableH)

  // Footer
  doc.setFontSize(7)
  doc.setTextColor(71, 85, 105)
  doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} — Planning Matias`, margin, 200)

  doc.save(`planning-${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}.pdf`)
}
