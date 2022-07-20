/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *
 * @author jihad
 */
public abstract class Character {

    
    
    //BIG
    //BIG BIG BIG IMPORTANT NOTE:::::::::::::::::::::::::::::::::::
    // might have to create methods like attack() and defend() (overidable) to set player stats everytime an item is equipped
    // will have to create setArmor, setWeapon, etc. both for player and enemies, while also randomly picking one from a range to enemies
    
    //variables
    String name;
    int hp, maxHp, xp;
    int[] Stats; //every level up player has x points to spend on his attributes
    int ArmorClass;
    
    //modifiers
    int strM, dexM, conM, intM, wisM, chaM;

    String[] EquipmentOn;

    public Character(String name, int maxHp, int xp) {
        this.Stats = new int[]{10, 10, 10, 10, 10, 10}; //STR,DEX,CON,INT,WIS,CHA, -future update - CON(hp), AGI (chance to dodge), INT (when we add spells) - - also make every upgrade a bigger difference
        this.ArmorClass = 10 + dexM;
        this.EquipmentOn = new String[]{"", "", ""};
        this.name = name;
        this.maxHp = maxHp;
        this.xp = xp;
        hp = maxHp;
    }

    //methods every character has
    public abstract int attack();

    public abstract int defend();

}
