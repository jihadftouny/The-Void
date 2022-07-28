/*
 * Click nbfs://nbhost/SystemFileSystem/Templates/Licenses/license-default.txt to change this license
 * Click nbfs://nbhost/SystemFileSystem/Templates/Classes/Class.java to edit this template
 */
package com.mycompany.thevoid;

/**
 *
 * @author jihad
 */
public class Armor extends Item {
    
    int armorAC, armorACM, armorStr; //ARMOR CLASS, ARMOR CLASS MOD (DEX), ARMOR STRENGTH REQUIRED

    // ARMOR JAVA OBJECTS
        // ACT 1
    public static Armor testArmor1 = new Armor("Jooj Armor", 5, 11, 2, 0);
    public static Armor testArmor2 = new Armor("Jaaj Armor", 5, 12, 2, 14);
    
    public static Armor[] ArmorsAct1 = {testArmor1, testArmor2};
    
    
    
    public Armor(String itemName, int itemCost, int armorAC, int armorACM, int armorStr) {      
        super(itemName, itemCost);
        this.armorAC = armorAC;
        this.armorACM = armorACM;
        this.armorStr = armorStr;
    }
    
    
    
    
    
}
