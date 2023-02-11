/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

import java.lang.annotation.Target;

/**
 *
 * @author jihad
 */
public class SkillEnemy extends Skill {

    public boolean isDamageDealt;
    
    
    //constructors
    public SkillEnemy(String name, int chargeUses, boolean isSelf, Element element) {
        super(name, chargeUses, element);
        if (!isSelf) {
            target = GameLogic.player;
        } else {
            target = GameLogic.enemy;
        }
    }

    public SkillEnemy(String name, int chargeUses, boolean isSelf, Element element, Condition condition) {
        super(name, chargeUses, element, condition);
        if (!isSelf) {
            target = GameLogic.player;
        } else {
            target = GameLogic.enemy;
        }
    }

    public SkillEnemy(String name, int chargeUses, boolean isSelf, Element element, Condition condition1, Condition condition2) {
        super(name, chargeUses, element, condition1, condition2);
        if (!isSelf) {
            target = GameLogic.player;
        } else {
            target = GameLogic.enemy;
        }
    }

    //SKILLS
    // test skills
    public static SkillEnemy testFireSkill = new SkillEnemy("Pyro Ball", 1, false, Element.fire) {
        @Override
        public int damage() {
            int baseDamage = (int)(Math.random()*3 + 2);
            damage = baseDamage - ((Player.pyroResistance)/100 * baseDamage);
            return damage;
        }

        @Override
        public String useText() {
            return Enemy.fullName + " used " + name;
        }
    };

    public static SkillEnemy testFreezeSkill = new SkillEnemy("Freeze!", 1, false, Element.ice, Condition.freeze) {
        @Override
        public int damage() {
            damage = 1;
            return damage;
        }

        @Override
        public String useText() {
            return Enemy.fullName + " used " + name;
        }

        @Override
        public void addConditionTarget(Condition condition) {
            if (target instanceof Player) {
                if (!Player.activeConditions.contains(condition)) {
                    Player.activeConditions.add(condition);
                }
            }
        }
    };

    @Override
    public int damage() {
        throw new UnsupportedOperationException("Not supported yet."); // Generated from nbfs://nbhost/SystemFileSystem/Templates/Classes/Code/GeneratedMethodBody
    }

    @Override
    public String useText() {
        throw new UnsupportedOperationException("Not supported yet."); // Generated from nbfs://nbhost/SystemFileSystem/Templates/Classes/Code/GeneratedMethodBody
    }
}
