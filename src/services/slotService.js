import { supabase, isUUID } from '../lib/supabase.js';
import { db } from './mockDatabase.js';

export const slotService = {
  async getSlotById(slotId) {
    if (!slotId) return null;
    try {
      if (isUUID(slotId)) {
        const { data, error } = await supabase
          .from('slots')
          .select('*')
          .eq('id', slotId)
          .maybeSingle();
        if (!error && data) return data;
      }
    } catch { /* fallback */ }

    const localSlots = (await db.read('seatsync_slots')) || [];
    return localSlots.find(s => s.id === slotId || s.slot_code === slotId) || null;
  },

  async getSlotByCode(slotCode) {
    if (!slotCode) return null;
    try {
      if (isUUID(slotCode)) {
        const { data, error } = await supabase
          .from('slots')
          .select('*')
          .eq('id', slotCode)
          .maybeSingle();
        if (!error && data) return data;
      }

      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .eq('slot_code', slotCode)
        .maybeSingle();
      if (!error && data) return data;
    } catch { /* fallback */ }

    return this.getSlotById(slotCode);
  },

  async getAdminSlotOccurrences({ libraryId = null, roomId = null, dateStr }) {
    try {
      let libId = libraryId;
      let rmId = roomId;

      if (!libId || !isUUID(libId)) {
        const { data: firstLib } = await supabase.from('libraries').select('id').limit(1).maybeSingle();
        if (firstLib?.id) libId = firstLib.id;
      }

      if (!rmId || !isUUID(rmId)) {
        const { data: firstRoom } = await supabase.from('rooms').select('id').limit(1).maybeSingle();
        if (firstRoom?.id) rmId = firstRoom.id;
      }

      if (isUUID(libId) && isUUID(rmId)) {
        const { data, error } = await supabase.rpc('get_admin_slot_occurrences', {
          p_library_id: libId,
          p_room_id: rmId,
          p_occurrence_date: dateStr
        });

        if (!error && data && Array.isArray(data)) {
          return data;
        }
      }
    } catch (err) {
      console.warn('[slotService] get_admin_slot_occurrences notice:', err.message);
    }

    // Local fallback
    const slotsData = (await db.read('seatsync_slots')) || [];
    const disabledList = (await db.read('seatsync_disabled_slots')) || [];
    return slotsData.map(s => {
      const disabledRecord = disabledList.find(d =>
        d.slotId === s.id && (d.scope === 'ALL_FUTURE' || d.date === dateStr || (d.startDate <= dateStr && d.endDate >= dateStr))
      );
      return {
        slot_id: s.id,
        slot_name: s.label || s.name,
        start_time: s.startTime || s.start_time,
        end_time: s.endTime || s.end_time,
        occurrence_date: dateStr,
        master_is_active: true,
        occurrence_status: disabledRecord ? 'cancelled' : 'scheduled',
        is_booking_enabled: !disabledRecord,
        cancellation_reason: disabledRecord?.reason || null,
        disabled_by_name: 'System Administrator'
      };
    });
  },

  async getStudentSlots({ libraryId = null, roomId = null, bookingDate }) {
    let resultSlots = [];
    try {
      let libId = libraryId;
      let rmId = roomId;

      if (!libId || !isUUID(libId)) {
        const { data: firstLib } = await supabase.from('libraries').select('id').limit(1).maybeSingle();
        if (firstLib?.id) libId = firstLib.id;
      }

      if (!rmId || !isUUID(rmId)) {
        const { data: firstRoom } = await supabase.from('rooms').select('id').limit(1).maybeSingle();
        if (firstRoom?.id) rmId = firstRoom.id;
      }

      if (isUUID(libId)) {
        // 1. Try primary aggregated RPC
        const { data, error } = await supabase.rpc('get_student_slot_availability', {
          p_library_id: libId,
          p_booking_date: bookingDate,
          p_room_id: isUUID(rmId) ? rmId : null
        });

        if (!error && data && Array.isArray(data) && data.length > 0) {
          resultSlots = data;
        } else {
          // 2. Fallback to get_student_slots
          const { data: fallbackData, error: fallbackErr } = await supabase.rpc('get_student_slots', {
            p_library_id: libId,
            p_room_id: isUUID(rmId) ? rmId : null,
            p_booking_date: bookingDate
          });

          if (!fallbackErr && fallbackData && Array.isArray(fallbackData) && fallbackData.length > 0) {
            resultSlots = fallbackData;
          }
        }
      }
    } catch (err) {
      console.warn('[slotService] getStudentSlots error:', err.message);
    }

    // Always enforce disabled occurrences check over returned slots
    try {
      const disabledList = await this.getDisabledOccurrences().catch(() => []);
      if (resultSlots.length > 0 && disabledList.length > 0) {
        resultSlots = resultSlots.map(s => {
          const disabledRecord = disabledList.find(d =>
            (d.slotId === s.slot_id || d.slotId === s.id) &&
            (d.scope === 'ALL_FUTURE' || d.date === bookingDate || (d.startDate <= bookingDate && d.endDate >= bookingDate))
          );
          if (disabledRecord) {
            return {
              ...s,
              effective_status: 'cancelled',
              is_booking_enabled: false,
              available_seats: 0,
              disabled_reason: disabledRecord.reason || 'Cancelled by administrator'
            };
          }
          return s;
        });
      }
    } catch { /* proceed */ }

    return resultSlots;
  },

  async cancelSlotOccurrence({ slotOccurrenceId = null, slotId = null, libraryId = null, roomId = null, dateStr = null, reason }) {
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) {
      throw new Error('Cancellation reason is required. Please enter a valid reason.');
    }

    let resolvedOccurrenceId = slotOccurrenceId;
    let libId = libraryId;
    let rmId = roomId;

    if (!libId || !isUUID(libId)) {
      const { data: firstLib } = await supabase.from('libraries').select('id').limit(1).maybeSingle();
      if (firstLib?.id) libId = firstLib.id;
    }

    if (!rmId || !isUUID(rmId)) {
      const { data: firstRoom } = await supabase.from('rooms').select('id').limit(1).maybeSingle();
      if (firstRoom?.id) rmId = firstRoom.id;
    }

    if (!resolvedOccurrenceId && isUUID(slotId) && isUUID(libId) && isUUID(rmId) && dateStr) {
      try {
        const { data: occId } = await supabase.rpc('ensure_slot_occurrence', {
          p_library_id: libId,
          p_room_id: rmId,
          p_slot_id: slotId,
          p_occurrence_date: dateStr
        });
        if (occId) resolvedOccurrenceId = occId;
      } catch { /* proceed */ }
    }

    if (resolvedOccurrenceId && isUUID(resolvedOccurrenceId)) {
      const { data, error } = await supabase.rpc('cancel_slot_and_notify_students', {
        p_slot_occurrence_id: resolvedOccurrenceId,
        p_reason: cleanReason
      });

      if (error) {
        throw new Error(error.message);
      }

      if (data) {
        return {
          success: true,
          slot_occurrence_id: data.slot_occurrence_id,
          cancelledBookingCount: data.affected_bookings_count || 0,
          notifiedStudentsCount: data.notifications_count || 0,
          cancellationReason: data.cancellation_reason
        };
      }
    }

    // Direct cancel_slot_occurrence fallback RPC
    if (isUUID(slotId) && isUUID(libId) && isUUID(rmId)) {
      const { data, error } = await supabase.rpc('cancel_slot_occurrence', {
        p_slot_id: slotId,
        p_library_id: libId,
        p_room_id: rmId,
        p_occurrence_date: dateStr,
        p_reason: cleanReason
      });

      if (error) throw new Error(error.message);
      return {
        success: true,
        slot_occurrence_id: data?.slot_occurrence_id,
        cancelledBookingCount: data?.affected_bookings_count || 0,
        notifiedStudentsCount: data?.affected_bookings_count || 0,
        cancellationReason: cleanReason
      };
    }

    // Local fallback
    const disabledList = (await db.read('seatsync_disabled_slots')) || [];
    disabledList.push({
      id: `DIS-${Date.now()}`,
      slotId,
      date: dateStr,
      scope: 'SELECTED_DATE',
      reason: cleanReason,
      disabledAt: new Date().toISOString()
    });
    await db.write('seatsync_disabled_slots', disabledList);

    return {
      success: true,
      cancelledBookingCount: 0,
      notifiedStudentsCount: 0,
      cancellationReason: cleanReason
    };
  },

  async enableSlotOccurrence({ slotOccurrenceId = null, slotId = null, dateStr = null, slotName = '' }) {
    if (slotOccurrenceId && isUUID(slotOccurrenceId)) {
      const { data, error } = await supabase.rpc('enable_slot_occurrence', {
        p_slot_occurrence_id: slotOccurrenceId
      });

      if (error) {
        throw new Error(error.message);
      }

      return {
        success: true,
        message: `${slotName || 'Slot'} enabled successfully for ${dateStr || 'selected date'}.`
      };
    }

    if (slotId && isUUID(slotId) && dateStr) {
      try {
        const { data: occ } = await supabase
          .from('slot_occurrences')
          .select('id')
          .eq('slot_id', slotId)
          .eq('occurrence_date', dateStr)
          .maybeSingle();

        if (occ?.id) {
          const { data, error } = await supabase.rpc('enable_slot_occurrence', {
            p_slot_occurrence_id: occ.id
          });
          if (!error && data) {
            return {
              success: true,
              message: `${slotName || 'Slot'} enabled successfully.`
            };
          }
        }
      } catch { /* proceed */ }
    }

    const disabledList = (await db.read('seatsync_disabled_slots')) || [];
    const updatedList = disabledList.filter(d => !(d.slotId === slotId && d.date === dateStr));
    await db.write('seatsync_disabled_slots', updatedList);

    return {
      success: true,
      message: `${slotName || 'Slot'} enabled successfully.`
    };
  },

  async disableMasterSlot({ slotId, reason }) {
    const cleanReason = String(reason || '').trim();
    if (!cleanReason) throw new Error('Reason is required for global slot disable.');

    if (isUUID(slotId)) {
      const { data, error } = await supabase.rpc('disable_master_slot', {
        p_slot_id: slotId,
        p_reason: cleanReason
      });

      if (error) throw new Error(error.message);
      return data;
    }
    return { success: true };
  },

  async enableMasterSlot({ slotId }) {
    if (isUUID(slotId)) {
      const { data, error } = await supabase.rpc('enable_master_slot', {
        p_slot_id: slotId
      });

      if (error) throw new Error(error.message);
      return data;
    }
    return { success: true };
  },

  async getDisabledOccurrences() {
    let dbDisabled = [];
    try {
      const { data, error } = await supabase
        .from('slot_occurrences')
        .select('*')
        .or('status.eq.cancelled,status.eq.disabled,is_booking_enabled.eq.false');
      if (!error && data) {
        dbDisabled = data.map(d => ({
          slotId: d.slot_id,
          date: d.occurrence_date,
          scope: 'SELECTED_DATE',
          reason: d.cancellation_reason || d.disabled_reason || 'Cancelled by administrator'
        }));
      }
    } catch { /* proceed to fallback */ }

    const localList = (await db.read('seatsync_disabled_slots')) || [];
    const combinedMap = new Map();
    [...dbDisabled, ...localList].forEach(item => {
      if (item && item.slotId) {
        const key = `${item.slotId}_${item.date || 'all'}`;
        combinedMap.set(key, item);
      }
    });
    return Array.from(combinedMap.values());
  }
};
