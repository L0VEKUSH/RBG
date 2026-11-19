'use strict';

const Student = require('../models/Student');
const Parent = require('../models/Parent');
const Faculty = require('../models/Faculty');
const { getRolePermissions } = require('../config/permissions');

function idOf(value) {
  return value && value._id ? value._id : value;
}

function uniqueClasses(rows) {
  return [...new Set((rows || []).map(row => row && row.class).filter(value => typeof value === 'string' && value))];
}

async function getActorClasses(user) {
  if (!user || !user._id) return [];

  if (user.role === 'student') {
    const student = await Student.findOne({ user: user._id, isActive: true }).select('class');
    return uniqueClasses(student ? [student] : []);
  }

  if (user.role === 'parent') {
    const parent = await Parent.findOne({ user: user._id, isActive: true }).select('children');
    const childIds = (parent?.children || []).map(idOf).filter(Boolean);
    const or = [{ parentUser: user._id }];
    if (childIds.length) or.unshift({ _id: { $in: childIds } });
    const children = await Student.find({ isActive: true, $or: or }).select('class');
    return uniqueClasses(children);
  }

  if (['teacher', 'class_teacher', 'faculty'].includes(user.role)) {
    const faculty = await Faculty.findOne({ user: user._id, isActive: true })
      .select('classTeacherOf subjects');
    if (!faculty) return [];
    const classes = [faculty.classTeacherOf?.class];
    for (const subject of faculty.subjects || []) classes.push(...(subject.classes || []));
    return [...new Set(classes.filter(value => typeof value === 'string' && value))];
  }

  return [];
}

function hasAnyPermission(user, ...expected) {
  if (!user || !user._id) return false;
  const permissions = new Set(getRolePermissions(user.role));
  for (const override of user.permissions || []) {
    if (typeof override !== 'string') continue;
    if (override.startsWith('-')) permissions.delete(override.slice(1));
    else permissions.add(override);
  }
  return permissions.has('*') || expected.some(permission => permissions.has(permission));
}

function targetClassesFilter(classes) {
  const choices = [
    { targetClasses: { $exists: false } },
    { targetClasses: { $size: 0 } },
    { targetClasses: 'All' },
  ];
  if (classes && classes.length) choices.push({ targetClasses: { $in: classes } });
  return { $or: choices };
}

module.exports = { getActorClasses, hasAnyPermission, targetClassesFilter };
