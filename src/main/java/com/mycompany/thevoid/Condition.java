/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *  Abilities will have a base turn of 2, modified based on corresponding STATS
 *  if STR gets greater than x value, player is able to apply force conditions as well
 */
public class Condition {
    
    public String name;
    int turns;
    
    // PHYSICAL (CON helps you resists them, STR cause them)
    Condition bleed = new Condition("Bleed", 2);
    Condition stun = new Condition("Stun", 2);
    Condition fracture = new Condition("Fracture", 100); // Needs rest to go away
    Condition regeneration = new Condition ("Regeneration", 2);
    
    
    // BASIC ELEMENTAL (CON resist, INT cause)
    Condition burn = new Condition("Burn", 2);
    Condition freeze = new Condition("Freeze", 2);
    Condition electrify = new Condition("Electrify", 2);
    Condition poison = new Condition("Poison", 2);
    
    
    // PSYCHIC (WIS resist/cause)
    Condition sleep = new Condition("Sleep", 2);
    Condition insanity = new Condition("Insanity", 2);
    
    // FORCE (WIS)
    Condition paralysis = new Condition("Paralysis", 2);
    Condition push = new Condition("Push", 1); // if pushed hard enough, can stun
    Condition aired = new Condition("Aired", 2);
    
    // STATS AUGMENTATION
    Condition strong = new Condition ("Strong", 2);
    Condition quick = new Condition ("Quick", 2);
    Condition healthy = new Condition ("Healthy", 2);
    Condition smart = new Condition ("Smart", 2);
    Condition wise = new Condition ("Wise", 2);
    Condition charming = new Condition ("Charming", 2);
    
    // STATS DEPRIVATION (the augmentation will be caused by substances, these are like withdrawals. Can get worse by time, can be healed always)
    Condition weak = new Condition ("Weak", 2);
    Condition slow = new Condition ("Slow", 2);
    Condition sick = new Condition ("Sick", 2);
    Condition dumb = new Condition ("Dumb", 2);
    Condition fool = new Condition ("Fool", 2);
    Condition repulsive = new Condition ("Repulsive", 2);
    
    
    public Condition(String name, int turns) {
        this.name = name;
    }
    
    public void setConditionEffect(Condition condition){
        
    }
    
}
