/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *
 * @author jihad
 */
public abstract class Skill {
    
    public String name;
    public int damage; //negative for healing? maybe
    public int chargeUses;
    
    Element element;
    Condition condition1, condition2;
    
    
    
    
    public Skill(String name, int chargeUses, Element element) {
        this.name = name;
        this.chargeUses = chargeUses;
        this.element = element;
    }

    public Skill(String name, int chargeUses, Element element, Condition condition) {
        this.name = name;
        this.chargeUses = chargeUses;
        this.element = element;
        condition1 = condition;
    }
    
    public Skill(String name, int chargeUses, Element element, Condition condition1, Condition condition2) {
        this.name = name;
        this.chargeUses = chargeUses;
        this.element = element;
        this.condition1 = condition1;
        this.condition2 = condition2;
    }
    
    // all skills have these methods
    public abstract int damage();
    public abstract String useText();
    
    
    
    // general methods
    public void addConditionTarget(){}; //here we should add condition objects and set them to whatever is the target
    
    public void addConditionSelf(){};
    
    public void removeConditionTarget(){};
    
    public void removeConditionSelf(){};
    
    
    
    
    // test skills
    public static Skill testFireSkill = new Skill("Pyro Ball", 1, Element.fire) {
        @Override
        public int damage() {
            damage = 2;
            return damage;
        }

        @Override
        public String useText() {
            return Enemy.fullName + " used " + name;
        }
    };
    
    
}
