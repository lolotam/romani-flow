import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import { corsHeaders } from 'https://esm.sh/@supabase/supabase-js@2.49.1/cors'

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/resend'

interface ExpiryItem {
  id: string
  name: string
  expiry_date: string
  days_until_expiry: number
  type: string
  employee_name?: string
  civil_id?: string
}

function calculateDaysUntilExpiry(expiryDate: string): number {
  const expiry = new Date(expiryDate)
  const now = new Date()
  return Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function getStatusText(days: number): string {
  if (days < 0) return 'منتهية الصلاحية'
  if (days <= 7) return 'تنتهي خلال أسبوع'
  return 'تنتهي خلال شهر'
}

function getStatusColor(days: number): string {
  if (days < 0) return '#f44336'
  if (days <= 7) return '#ff9800'
  return '#9c27b0'
}

function buildHTMLReport(
  expiringEmployees: ExpiryItem[],
  expiringDocuments: ExpiryItem[],
  currentDate: string
): string {
  const totalExpiring = expiringEmployees.length + expiringDocuments.length
  const expiredCount = [...expiringEmployees, ...expiringDocuments].filter(i => i.days_until_expiry < 0).length
  const criticalCount = [...expiringEmployees, ...expiringDocuments].filter(i => i.days_until_expiry >= 0 && i.days_until_expiry <= 7).length

  const employeeRows = expiringEmployees.map(emp => `
    <tr style="background-color: ${emp.days_until_expiry < 0 ? '#ffebee' : emp.days_until_expiry <= 7 ? '#fff3e0' : '#f3e5f5'};">
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">${emp.name}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">${emp.civil_id || '-'}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">${new Date(emp.expiry_date).toLocaleDateString('ar-EG')}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">${Math.abs(emp.days_until_expiry)} ${emp.days_until_expiry < 0 ? 'يوم (منتهية)' : 'يوم'}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">
        <span style="padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; color: white; background: ${getStatusColor(emp.days_until_expiry)};">${getStatusText(emp.days_until_expiry)}</span>
      </td>
    </tr>
  `).join('')

  const documentRows = expiringDocuments.map(doc => `
    <tr style="background-color: ${doc.days_until_expiry < 0 ? '#ffebee' : doc.days_until_expiry <= 7 ? '#fff3e0' : '#f3e5f5'};">
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">${doc.name}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">${doc.employee_name || '-'}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">${new Date(doc.expiry_date).toLocaleDateString('ar-EG')}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">${Math.abs(doc.days_until_expiry)} ${doc.days_until_expiry < 0 ? 'يوم (منتهية)' : 'يوم'}</td>
      <td style="padding: 12px; border-bottom: 1px solid #ecf0f1; text-align: right;">
        <span style="padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; color: white; background: ${getStatusColor(doc.days_until_expiry)};">${getStatusText(doc.days_until_expiry)}</span>
      </td>
    </tr>
  `).join('')

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: 'Segoe UI', Tahoma, sans-serif; background: #f5f5f5; margin: 0; padding: 0; direction: rtl;">
  <div style="max-width: 800px; margin: 20px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center;">
      <h1 style="font-size: 28px; margin-bottom: 10px;">🔔 تقرير انتهاء صلاحية الوثائق والإقامات</h1>
      <p style="font-size: 16px; opacity: 0.9;">نظام إدارة الموظفين والوثائق - ROMANI</p>
      <p style="font-size: 14px; opacity: 0.8;">تاريخ التقرير: ${currentDate}</p>
    </div>
    <div style="padding: 30px;">
      <div style="background: #fff3cd; border: 1px solid #ffeaa7; color: #856404; padding: 15px; border-radius: 6px; margin-bottom: 25px; text-align: center; font-weight: bold;">
        ⚠️ إجمالي العناصر المنتهية أو القريبة من الانتهاء: ${totalExpiring} | منتهية: ${expiredCount} | حرجة: ${criticalCount}
      </div>
      ${expiringEmployees.length > 0 ? `
      <div style="margin-bottom: 35px;">
        <h2 style="font-size: 22px; color: #2c3e50; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 2px solid #e67e22;">📋 إقامات الموظفين المنتهية أو القريبة من الانتهاء (${expiringEmployees.length})</h2>
        <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden;">
          <thead><tr style="background: #34495e; color: white;">
            <th style="padding: 12px; text-align: right;">اسم الموظف</th>
            <th style="padding: 12px; text-align: right;">الرقم المدني</th>
            <th style="padding: 12px; text-align: right;">تاريخ انتهاء الإقامة</th>
            <th style="padding: 12px; text-align: right;">المدة المتبقية</th>
            <th style="padding: 12px; text-align: right;">الحالة</th>
          </tr></thead>
          <tbody>${employeeRows}</tbody>
        </table>
      </div>` : ''}
      ${expiringDocuments.length > 0 ? `
      <div style="margin-bottom: 35px;">
        <h2 style="font-size: 22px; color: #2c3e50; margin-bottom: 15px; padding-bottom: 8px; border-bottom: 2px solid #e74c3c;">📄 الوثائق المنتهية أو القريبة من الانتهاء (${expiringDocuments.length})</h2>
        <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 6px; overflow: hidden;">
          <thead><tr style="background: #34495e; color: white;">
            <th style="padding: 12px; text-align: right;">اسم الوثيقة</th>
            <th style="padding: 12px; text-align: right;">الموظف</th>
            <th style="padding: 12px; text-align: right;">تاريخ الانتهاء</th>
            <th style="padding: 12px; text-align: right;">المدة المتبقية</th>
            <th style="padding: 12px; text-align: right;">الحالة</th>
          </tr></thead>
          <tbody>${documentRows}</tbody>
        </table>
      </div>` : ''}
      ${totalExpiring === 0 ? `
      <div style="text-align: center; padding: 40px; color: #27ae60; font-size: 18px; background: #d5f4e6; border-radius: 6px; margin: 20px 0;">
        ✅ لا توجد وثائق أو إقامات منتهية أو قريبة من الانتهاء
      </div>` : ''}
    </div>
    <div style="background: #ecf0f1; padding: 20px; text-align: center; color: #7f8c8d; border-top: 1px solid #bdc3c7;">
      <p>تم إرسال هذا التقرير تلقائياً من نظام ROMANI لإدارة الموظفين والوثائق</p>
      <p style="font-size: 12px; margin-top: 5px;">© ${new Date().getFullYear()} ROMANI - جميع الحقوق محفوظة</p>
    </div>
  </div>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')

    // Parse request body
    let recipientEmail = ''
    let senderEmail = 'ROMANI Reports <onboarding@resend.dev>'
    try {
      const body = await req.json()
      if (body.recipientEmail) recipientEmail = body.recipientEmail
      if (body.senderEmail) senderEmail = body.senderEmail
    } catch {
      // empty body is fine for cron calls
    }

    if (!recipientEmail) {
      return new Response(
        JSON.stringify({ success: false, error: 'recipientEmail is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Query expiring employees (residency within 30 days)
    const { data: employees } = await supabase
      .from('employees')
      .select('id, name, civil_id_no, residency_expiry_date')
      .not('residency_expiry_date', 'is', null)

    const expiringEmployees: ExpiryItem[] = (employees || [])
      .map(emp => ({
        id: emp.id,
        name: emp.name,
        expiry_date: emp.residency_expiry_date!,
        days_until_expiry: calculateDaysUntilExpiry(emp.residency_expiry_date!),
        type: 'residency',
        civil_id: emp.civil_id_no || undefined,
      }))
      .filter(emp => emp.days_until_expiry <= 30)

    // Query expiring documents
    const { data: documents } = await supabase
      .from('documents')
      .select('id, title, expiry_date, employee_id')
      .not('expiry_date', 'is', null)

    // Get employee names for documents
    const employeeIds = [...new Set((documents || []).filter(d => d.employee_id).map(d => d.employee_id))]
    let employeeMap: Record<string, string> = {}
    if (employeeIds.length > 0) {
      const { data: empNames } = await supabase
        .from('employees')
        .select('id, name')
        .in('id', employeeIds)
      if (empNames) {
        employeeMap = Object.fromEntries(empNames.map(e => [e.id, e.name]))
      }
    }

    const expiringDocuments: ExpiryItem[] = (documents || [])
      .map(doc => ({
        id: doc.id,
        name: doc.title,
        expiry_date: doc.expiry_date!,
        days_until_expiry: calculateDaysUntilExpiry(doc.expiry_date!),
        type: 'document',
        employee_name: doc.employee_id ? employeeMap[doc.employee_id] : undefined,
      }))
      .filter(doc => doc.days_until_expiry <= 30)

    const totalExpiring = expiringEmployees.length + expiringDocuments.length

    if (totalExpiring === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No expiring items found', totalExpiring: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check for Resend API keys
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Resend connector not configured. Please connect the Resend connector to enable email sending.',
          totalExpiring,
          expiringEmployees: expiringEmployees.length,
          expiringDocuments: expiringDocuments.length,
        }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Build and send report
    const currentDate = new Date().toLocaleDateString('ar-EG')
    const html = buildHTMLReport(expiringEmployees, expiringDocuments, currentDate)

    const emailResponse = await fetch(`${GATEWAY_URL}/emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'X-Connection-Api-Key': RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: senderEmail,
        to: [recipientEmail],
        subject: `🔔 تقرير يومي - ${totalExpiring} وثيقة/إقامة تحتاج انتباهك - ${currentDate}`,
        html,
      }),
    })

    const emailResult = await emailResponse.json()

    if (!emailResponse.ok) {
      throw new Error(`Resend API call failed [${emailResponse.status}]: ${JSON.stringify(emailResult)}`)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Report sent successfully to ${recipientEmail}`,
        totalExpiring,
        expiringEmployees: expiringEmployees.length,
        expiringDocuments: expiringDocuments.length,
        emailId: emailResult.id,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: unknown) {
    console.error('Error in send-expiry-report:', error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
